---
paths:
  - 'app/components/map/**'
  - 'app/composables/map/**'
  - 'server/api/tiles/**'
  - 'server/utils/mvt.ts'
  - 'server/utils/basemap-pmtiles.ts'
  - 'server/utils/cache.ts'
  - 'service-worker/**'
  - 'app/pages/offline.vue'
---

## "Show on the map" and a popup's own link were both hard-navigating, quietly discarding every overlay toggle

Reported directly: toggling an overlay on, opening an inscription from its
map marker, then following "Show on the map" back — every overlay had
switched itself off. Confirmed live with Playwright (a `window` marker set
right after landing on the detail page, checked for survival after
following the link back): both links were causing a genuine full browser
navigation, not a client-side route change, and a hard navigation discards
`useState('inscriptions-active', …)` and every sibling overlay flag along
with it — they live on the Nuxt app instance, which the reload replaces
outright. Nothing in the app was resetting the flags on purpose; the
`useState` values were never surviving to be reset.

**Two independent culprits, not one.** First: a `UButton`/`NuxtLink` whose
`to` target is the _same_ app but a _different_ route distinguished only by
its camera hash (`/#map=17.00/41.5/12.7`, read back by
`useCameraState`'s `restoreCamera()`) falls through to a plain,
router-unintercepted anchor rather than a `router.push` — confirmed by
setting a global marker after page load and checking whether it survived
the click; it did not, and `window.performance`-style reasoning wasn't
even needed once the marker itself was gone. `site/[slug]/index.vue`'s own
`mapLink`/"Show on the map" button (the pattern the inscription detail
pages' identical buttons were modelled on) carried the exact same latent
bug — not something the inscriptions feature introduced, only what finally
surfaced it. Fixed in all three places (`site/[slug]/index.vue`,
`inscriptions/[edhId].vue`, `inscriptions/attic/[aioKey].vue`) by replacing
`:to="mapLink"` with a plain `@click` handler calling `navigateTo(mapLink)`
directly — `navigateTo` goes through Vue Router itself rather than through
whatever heuristic `UButton`'s `to` prop uses to decide a link is
"internal", and a Playwright check confirmed a marker set before the click
now survives it.

Second, and the one a reader actually hits first: `useInscriptionsOverlay.ts`
and `useAtticInscriptionsOverlay.ts` build their popups with
`Popup.setHTML(...)` — raw markup, not a Vue template (see "Overlay popups
are a themed card" below for the same fact biting a different way) — and
its "Open inscription →" link was a plain `<a href="/inscriptions/...">`
with nothing to stop the browser handling it natively. `showInscriptionPopup`/
`showAtticInscriptionPopup` now grab the popup's own DOM element right
after `addTo(map)` and attach a `click` listener to its one `<a>` that
calls `event.preventDefault()` and `navigateTo(...)` itself — the same fix
in spirit as swapping `UButton`'s `to` for a handler above, applied to raw
HTML instead of a component prop, since there is no Vue-template path
available to fix here at all.

Verified end to end with Playwright, not just read: toggle "Show
inscriptions" on, click the marker, click "Open inscription" in its popup,
click "Show on the map" on the resulting detail page, reopen the overlay
menu — `aria-checked` on "Show inscriptions" reads `true` and two fresh
tile requests fire, proving the layer actually redrew rather than merely
reporting itself on.

## A theme switch stacked one extra click listener per overlay, forever

Reported directly: after a fresh page load, one click on a popup's "×"
closed it; after switching dark/light mode, the same popup needed two
clicks; a second switch needed three, and so on, growing without bound.

Root cause confirmed by reading, then reproduced live in a real browser
before fixing anything (Playwright, clicking a port icon, toggling the
theme button, clicking the same icon again, counting `.maplibregl-popup`
DOM nodes): every overlay's `attach*Overlay` (battles, ports, routes, minor
features, coin hoards, inscriptions) unconditionally calls
`map.on('click'|'mouseenter'|'mouseleave', LAYER_ID, ...)` on every
invocation, with no matching `.off()` anywhere in `app/composables/map/`.
`attach*Overlay` runs once on initial load, but also every time
`keep*OverlayThroughStyleChanges`'s `styledata` listener finds the source
missing — and `MapCanvas.vue`'s `watch(currentStyle, …) { map.setStyle(style)
}` fires on every theme toggle (`currentStyle` is a computed over
`isDark`). MapLibre's diffed `setStyle` reconciles sources and layers but
leaves already-bound `map.on(...)` listeners alone (they are runtime API
state, not part of the style document — the same "images survive `setStyle`"
fact already documented below under "reference marks over raster basemaps").
So a style change removes the source/layer, `attach*Overlay` re-adds them
_and_ a brand-new click handler on top of every one already sitting on the
map instance; one tap then fires N handlers, opening N stacked, visually
identical `Popup`s at the same point.

Fixed with `bindOverlayListenersOnce(map, layerId, bind)`
(`useMapInstance.ts`), a `WeakMap<MapLibreMap, Set<string>>` guarding the
three listener registrations independently of whether the source/layer
currently exist — so a `styledata`-triggered reattachment re-adds the source
and layer (still required) without ever re-adding the listeners, while a
genuinely new `Map` instance (a remount, not a style swap) still binds its
own. All six overlays call it. Verified two ways: a unit test
(`useMapInstance.test.ts`) asserting a bind callback fires once across
repeated calls for the same map+layer and independently per map instance and
per layer id; and the live Playwright repro above, re-run after the fix —
exactly one popup after two theme switches, closed with exactly one click.

## Overlay popups show everything the database actually has, plus a tap-to-open hint

Investigated on request: whether the battle/port/route/minor-feature/coin-hoard
overlay popups could show more than they did. Checked every column each
`antiquity_*` table actually carries against what its tile SQL selects and
what its popup builder renders — three real gaps found, all fixed rather than
just reported, since each was a one-line addition with data already sitting
one hop away:

- **Coin hoards had `geonames_url` flowing all the way from the database
  through the MVT tile into `CoinHoardFeatureProperties` and then simply
  never being read.** `buildCoinHoardPopupHtml` built its two lines and
  stopped. Fixed: a "View on GeoNames ↗" link, same pattern as the port
  popup's Pleiades/Wikipedia links.
- **Battles never selected `wikidata_id` or `location_precision` into the
  tile at all**, even though both columns exist on every row
  (`antiquity_battles.wikidata_id` is `.notNull()`). Added both to
  `buildBattleTileSql`, and the popup now always links to the Wikidata item
  (`https://www.wikidata.org/wiki/{id}`) and adds an "approximate location"
  caveat when Wikidata's own `geoPrecision` was coarse (`location_precision
= 'rough'`, from `13-battles.ts`'s own `locationPrecision()`).
- **Ports and minor features were already complete** — every column
  `antiquityPorts`/`antiquityFeatures` carries is already selected and
  already rendered (`buildPortPopupHtml`, `buildFeaturePopupHtml`). Nothing
  to add there.

**A follow-up report: the minor-antiquities popup showed cryptic codes like
"Fe", "CHR", "M" for a mine or quarry, with no explanation.** These are real
AWMC data, not corruption — confirmed against the actual DBF values in
`.import/awmc-minor-features/cultural-shapefiles.zip` (queried live from
Postgres, not guessed at), and undocumented anywhere in AWMC's own release:
`mines_quarries` ships no `.shp.xml` metadata file, unlike several sibling
layers in the same zip. `Material` is a commodity/rock-type code —
`Fe`/`Cu`/`Pb`/`Ag`/`Au`/`Zn` are chemical symbols (iron, copper, lead,
silver, gold, zinc), `M`/`Ls`/`Ss`/`Gr` are rock abbreviations (marble,
limestone, sandstone, granite) — sometimes multiple, comma-separated
(`"Au, Fe"`). `Period`/`timeperiod` (present on every non-bridge kind:
mines/quarries, dams, cemeteries, forts, tumuli — confirmed by querying all
of them, not assumed from one) is a run of single-letter period codes,
`A`/`C`/`H`/`R`/`L` (Archaic/Classical/Hellenistic/Roman/Late Antique), each
optionally followed by `?` marking that one period's attestation uncertain
(`"R?L"`, `"H?R?"`, `"C?H?R?"`). Bridges are the one exception: their own
five 0/1 flag columns are already expanded to full words by `bridgePeriods()`
at import time, so `buildFeaturePopupHtml`'s `expandPeriods` is skipped for
that kind — running it on an already-expanded string would find no matching
letters and just pass it through, but skipping is the more honest statement
of why. An unrecognised code (the one `Cn` row, whatever it stands for) is
shown verbatim rather than guessed at, the same restraint applied everywhere
else in this codebase to data whose meaning isn't fully known (see ORBIS's
`e`/`s` figures above). Decoding happens in `useMinorFeatureOverlay.ts` at
popup-render time, not at import — the raw codes stay in Postgres exactly as
AWMC published them, reproducible and re-decodable if the mapping ever needs
correcting.

**Routes are the one case where more genuinely isn't available without new
work.** `antiquity_routes` was never given `e`/`s` columns at all —
`15-orbis-routes.ts` reads ORBIS's own cost/duration figures and discards
them at import time, undocumented and with no verified unit or meaning (see
`.claude/rules/antiquity-basemaps.md`'s ORBIS section). Surfacing them would
mean a schema migration, a re-import, and — the actual blocker — reverse-
engineering what the numbers mean well enough to label them honestly. Not
attempted here; flagged rather than guessed at, same restraint the original
import already applied.

**Clickability indicator.** Every overlay layer already sets
`cursor: pointer` on `mouseenter` — but that affordance is invisible on a
touch device, which has no hover state at all, and this project is mobile
first. Rather than inventing a decorative on-map cue (a ring, a pulse) that
the design brief's minimal-linework rule would fight, `Legend.vue` gained one
sentence, `legend.tapForDetails`, shown once under the panel title rather
than repeated in each of its five overlay sections — true of every layer the
key describes, so one line does the job. This is not a full fix for
discoverability (a reader has to open the key at least once to see it), but
it is the honest, low-effort answer that fits the existing "the key explains
the marks" mechanism rather than adding a new one.

**The legend panel can outgrow the map.** Reported: with several overlays
switched on at once, each contributing its own key section, the panel grew
taller than the viewport and overran the top edge. `Legend.vue`'s panel
(`#map-legend`) now carries `max-h-[min(70vh,32rem)] overflow-y-auto` —
capped and scrollable rather than assuming a fixed maximum section count,
the same shape `.maplibregl-ctrl-attrib.maplibregl-compact-show` already
uses above for the same reason (several overlay credits stacking up).

**The frontier's own plan marks (watchtower, fort, fortlet, fortress, camp)
only render while Barrington is the active basemap — reported as confusing
with no explanation on screen.** `useLimesOverlay.ts`'s own docstring already
states why: `limes-installations` (the Pleiades-sourced military places
promoted to these marks) reads the `atlas` vector source, which exists only
on the Barrington sheet, and is silently skipped on every other basemap —
the frontier line itself and contributed forts still draw everywhere.
`Legend.vue` now shows `legend.frontierMarksBarringtonOnly` under the marks
list whenever `view !== 'antiquity-awmc'` while "Follow the limes" is on,
rather than leaving a reader to notice the marks vanish with no explanation
when they switch basemaps.

## The Barrington sheet's own places (`atlas-places`) were never clickable at all

Reported as two things at once — "get more information on the Barrington
map's default sites" and, separately, "differentiate clickable icons from
non-clickable ones" — that turned out to be the same bug. The legend already
promises `legend.tapForDetails` ("Tap or click a mark on the map to open what
is recorded about it") for **every** mark, disc or pencil-style reference
alike, and every other reference layer (battles, ports, minor features, coin
hoards) really does open a popup on click. `atlas-places` — Pleiades'
~38,000 places drawn straight into the Barrington style by
`useBasemapStyle.ts` (`buildAtlasStyle`, not through the toggleable-overlay
pattern the others use) — was the one silent exception: no click handler was
ever registered for it anywhere in the codebase, confirmed by grepping every
`on('click', ...)` registration in `app/composables/map/`. The mark looked
exactly like a clickable reference glyph and did nothing.

Fixed with `useAtlasPlaceOverlay.ts`, attached once from `MapCanvas.vue`'s
`load` handler with no `attach`/`detach`/`keep*ThroughStyleChanges` trio
unlike every other overlay in this file: there is no source or layer to add
or remove here, only a delegated `map.on('click'|'mouseenter'|'mouseleave',
layerId, ...)` registration, and MapLibre's delegated listener filters by
`getLayer(layerId)` **at event time**, not at registration time (read
straight out of `maplibre-gl`'s own `_createDelegatedListener` before relying
on it) — so registering once, regardless of which basemap is active, is
correct and complete. It quietly does nothing on every basemap but
Barrington and starts firing again the moment the reader switches back.

**Two layer ids, not one** — `ATLAS_PLACE_LAYER_IDS = ['atlas-places',
'limes-installations']`. The second is the military subset of the first,
promoted to its own layer with the frontier's own plan marks while "Follow
the limes" is on (`useBasemapStyle.ts`'s `'limes-installations'` layer,
same `atlas`/`places` source and property shape). Missing it would have
made every fort and watchtower on the frontier stop responding to a tap
the moment the switch was flipped on, while everything drawn the identical
pencil-and-no-disc way elsewhere on the sheet kept working — the exact
inconsistency this fix exists to close, not a second bug.

**The tile SQL was also missing half its own columns.** `antiquity_places`
already carries `description`, `feature_types`, `min_year`, `max_year` and
`location_precision` — none of them were in `buildAtlasTileSql`'s `places`
`SELECT` before this, only `id`/`pleiades_id`/`title`/`category`/`military`/
`mark`. Added all five (`server/utils/atlas.ts`), so the popup can show a
category or raw feature type, a date range (via `formatFrontierYears`, the
same BC/AD helper the limes panel already uses), a truncated description
(capped at 280 characters client-side — some Pleiades entries run past
1,300, most average 90, checked against the live table rather than
guessed), a "location is approximate" note when Pleiades' own precision is
`rough`, and a "View on Pleiades ↗" link. **Changing the tile SQL without a
schema migration still needed a cache bust**: the atlas tile cache is keyed
by a version counter (`vestigian:atlas-version`), not by query content, so
already-cached tiles kept serving the old five-column shape until every
`atlas:v*` key was cleared by hand in Redis/Valkey — a code-only change to
what a tile selects is invisible to that counter, and needs the same manual
cache flush an operator would do after this kind of deploy.

With this fix, every icon on the main map now genuinely does what
`legend.tapForDetails` already claimed — the "differentiate clickable from
non-clickable" report and the "more information on Barrington's sites"
report were the same missing wire, not two separate features. The only
non-clickable marker left is the Tabula Peutingeriana network overlay's
place dots (`useTabulaPeutingerianaOverlay.ts`) — a different page entirely
(`/tabula-peutingeriana`, its own IIIF deep-zoom viewer), not something the
map's own legend or click-affordance promises anything about.

## Marker glyphs are Lucide paths, not hand-drawn — one exception, plan-view fort marks

`useSiteIcons.ts`'s category, battle and port glyphs were originally drawn by
hand as bespoke Path2D strings, framed as elevations a notebook-carrying
visitor would sketch. Reconsidered and replaced: Lucide is already this
project's icon system everywhere else in the interface (`i-lucide-*` via
`@nuxt/icon`, self-hosted through the `@iconify-json/lucide` devDependency,
never a runtime fetch — see `nuxt.config.ts`), so the map's own markers
hand-rolling an approximation of icons the app already ships was the
inconsistency, not the norm. Licence checked directly against
`node_modules/@iconify-json/lucide` and the upstream `LICENSE` before
reuse: ISC for Lucide's own icons, MIT for the small Feather-derived subset
— both permissive, rehosting and modifying is explicitly allowed by either.

Paths are copied verbatim from Lucide's 24×24 `stroke-width:2` source
(`node_modules/@iconify-json/lucide/icons.json`), which is why no rescaling
was needed — the project's own glyphs already used that exact viewBox.
Multi-element icons (several `<path>`s, or a `<circle>`) are flattened into
one `d` string, since `rasteriseIcon` takes a single path and `Path2D`
parses the full SVG path grammar — including arcs — from one concatenated
string as well as from several separate elements. A `<circle cx cy r>`
becomes two arc commands: `M ${cx-r} ${cy} A ${r} ${r} 0 1 0 ${cx+r} ${cy}
A ${r} ${r} 0 1 0 ${cx-r} ${cy}` (used for `anchor`'s ring and
`crosshair`'s outer circle). Verified rendered, not just typechecked — both
the canvas-rasterised map markers and `Legend.vue`'s inline-SVG copies were
screenshotted in a running dev server after the change.

Current mapping: `settlement`→`building-2`, `fortification`→`castle`,
`sanctuary`→`landmark`, `burial`→`pyramid`, `infrastructure`→`milestone`,
`villa`→`house`, `production`→`factory`, `findspot`→`amphora`,
`other`→`crosshair`, battles→`swords`, ports→`anchor`,
`mine_quarry`→`pickaxe`, `cemetery`→`cross`.

**Two families deliberately stayed hand-drawn — not an oversight, no
matching Lucide icon exists for either concept:**

- `LIMES_ICON_PATHS` — these are fort _plans_, drawn from above (playing-card
  rectangle, rounded corners, gates), not elevations. No general-purpose
  icon set represents "a Roman fort seen from above"; forcing a
  building/castle icon here would lose the exact distinction (tower vs.
  fortlet vs. fort vs. fortress, told apart by nested-rectangle size) the
  hand-drawn plans exist to carry.
- `BRIDGE_ICON_PATH`, `DAM_ICON_PATH`, `TUMULUS_ICON_PATH`,
  `COIN_HOARD_ICON_PATH` (the AWMC minor-feature and coin-hoard glyphs) —
  no Lucide icon covers a dam, a burial mound in elevation, or a stack of
  coins drawn side-on. `cemetery`'s cross and `mine_quarry`'s pickaxe _were_
  swapped to Lucide, since those two have exact matches; the other four in
  the same family did not, and mixing sourced and hand-drawn paths within
  one family is fine visually — `rasteriseIcon` applies the same stroke
  weight, ink colour and reference/ground treatment regardless of where a
  path came from, so the rendering treatment is what actually keeps the
  sheet consistent, not a shared origin for the path data.

This does trade away some of the literal "sketched in a field notebook"
character the design brief describes — a generic icon set reads slightly
more like a modern app than a bespoke elevation would. Recorded as a
deliberate call, made on explicit direction, not something to silently
re-litigate back to hand-drawn glyphs later.

## Six glyphs are filled game-icons.net silhouettes, not stroked Lucide outlines

Reported directly: settlement, infrastructure, production, "other" (site
categories), cemetery and bridge (minor antiquities) read as too generic and
too modern to belong on an ancient-world atlas — a skyline, a factory, a
crosshair, a plain cross and a Lucide arch don't say "ancient" the way a
purpose-picked icon can. Researched across Flaticon, Noun Project and
game-icons.net (candidates saved to an artifact for the user to choose from
first — see the icon-candidates research); the user picked, per category:
delapouite's `village` (settlement), Lucide's `cog` (infrastructure, kept
from Lucide since it was already a good fit), delapouite's `anvil` credited
to Lorc (production), delapouite's `menhir` (other), delapouite's `graveyard`
(cemetery) and delapouite's `stone-bridge` (bridge). Every game-icons.net
pick is **CC BY 3.0**, checked directly against the site's own licence page,
attribution owed to the credited artist — Delapouite for four of the five,
Lorc for the anvil.

**Game-icons.net silhouettes are filled, authored edge-to-edge in a 512×512
viewBox — nothing like Lucide's 24×24 stroked outlines**, and `rasteriseIcon`
only ever knew how to stroke a path. Rather than force a filled silhouette
through the stroke pipeline (which draws only the path's own outline edges —
visually broken for a shape meant to be solid), `IconGlyph` (`useSiteIcons.ts`)
carries `viewBox`/`filled` alongside the path, and `rasteriseIcon` branches:
fill for a filled glyph, stroke for an outline one. A filled glyph is scaled
and centred into an 18-unit box inside the shared 24-unit icon space
(`GAME_ICON_TARGET_SIZE`/`GAME_ICON_OFFSET`/`GAME_ICON_SCALE`) — roughly the
same padding a Lucide outline already carries inside its own 24-unit box —
rather than letting a silhouette authored edge-to-edge touch the disc's own
ring. `Legend.vue` and `FeaturePicker.vue` apply the identical transform via
SVG's own `transform` attribute on the `<path>`, so the map, the key and the
picker cannot drift apart on how a filled glyph sits in its circle — the same
"the paths are also the legend" principle this file already documents for
the Lucide set. `SITE_ICON_PATHS`/`MINOR_FEATURE_ICON_PATHS` (plain path
strings) were renamed `SITE_ICON_GLYPHS`/`MINOR_FEATURE_ICON_GLYPHS`
(`Record<_, IconGlyph>`) throughout — every consumer needs to know whether to
fill or stroke, not just what to draw.

## Reference marks over raster basemaps get a halo, and a darker ink where a halo alone wasn't enough

Reported directly: icon contrast was poor on the Antiquity (DARE) and
Satellite views, in both themes. Every reference mark (a borrowed row, no
disc — battles, ports, coin hoards, minor antiquities, Pleiades' military
places on the frontier) is drawn in a single fixed mid-tone ink
(`ATLAS_MARK_INK`) with no backing disc, which is legible against a flat
vector sheet — Vestigian's own recolouring, or the Barrington sheet, both a
known, controlled colour — but not against real photography, where the ink
can land on a pixel of any value at all.

Fixed with a halo, not a colour change: `SiteIconPalette.haloOnRaster`, set
in `useViewportTiles.ts`'s `palette` computed from `view.value ===
'antiquity-dare' || view.value === 'satellite'` — **not**
`isAntiquityView(view)`, which also covers the Barrington sheet. Barrington
is our own flat vector fill, the same category of "known colour" as the
Vestigian recolouring, so it's deliberately excluded even though
`resolveSheetTone` groups it with DARE for a different reason (tone, not
contrast). When set, `rasteriseIcon` draws a translucent light stroke behind
the mark before the ink — wider for a filled glyph (drawn in its own scaled
sub-space) than for a stroked outline — the standard cartographic
halo-behind-a-line technique, the same idea `useBasemapStyle.ts`'s own
`labelHalo` already applies to map labels. **This paragraph originally
claimed re-registration "already happens for free" because `setStyle` wipes
the image registry on every basemap switch — that was never actually true,
and is the reason none of the colour/halo work in this section visibly took
effect until a fourth report tracked it down. See the "what actually made
all three of the reports above land as 'nothing changed'" paragraph below
for the real mechanism and the fix.**

**The halo was real but nearly invisible for every filled game-icons glyph**
(settlement, production, other, cemetery, bridge), reported again after the
fix above shipped — "icon contrast is still bad on satellite and DARE." The
filled-icon branch of `rasteriseIcon` draws inside a second, nested
transform (`translate(GAME_ICON_OFFSET)` then `scale(GAME_ICON_SCALE,
GAME_ICON_SCALE)`, `GAME_ICON_SCALE = 18/512 ≈ 0.0352`) so the 512-unit
game-icons path fits the 24-unit space every other glyph draws in — and the
halo's `lineWidth` was set to a flat `26` measured in that same doubly-scaled
space. Once rendered, that line width is `GAME_ICON_SCALE` times thinner
than it reads on paper: worked out and confirmed with a standalone canvas
comparison (not guessed), `26` in native units came out under 1 real screen
pixel, next to ~3px for the outline family's halo at its own fixed `3.2`.
Fixed by keeping one shared `REFERENCE_HALO_WIDTH` constant defined in the
same 24-unit space the outline halo already uses, and dividing by
`GAME_ICON_SCALE` only for the filled branch (`REFERENCE_HALO_WIDTH /
GAME_ICON_SCALE`) so both families render the same visual thickness —
confirmed with the same standalone canvas rendering both before and after.

**Reported a third time, correctly, as a colour problem rather than a halo
problem: "change icon colours ... so contrast becomes greater (also a11y)."**
Measured this time instead of tuning the halo again — `ATLAS_MARK_INK`
(`#8c8271`) itself only reaches **3.54:1** against its own halo colour
(`#faf7ef`), and the claim above that Barrington's fills were "a known
colour a mark already contrasts against" was never actually checked: against
the sheet's real flat fills (`land #f2ede1`, `sea #c8d3d0`, `inland
#bccbc8`, `urban #ded2b8`) it measures **2.26–3.24:1**, under WCAG 1.4.11's
3:1 floor for graphical objects in three of the four. `SiteIconPalette`
gained `referenceInk`, set in `useViewportTiles.ts`'s `palette` to
`base.ink` (the same ink a contributed marker's own disc already uses) for
`satellite` and `antiquity-awmc` specifically — a **different** pair of
basemaps than `haloOnRaster` covers: DARE is excluded here because it's an
illustrated historical map with its own muted palette, not raw photography,
and measured fine already. Every `register*Icon` function now resolves its
reference ink through one `referenceInk(palette)` helper
(`palette.referenceInk ?? ATLAS_MARK_INK`) instead of hardcoding the
constant, so a basemap that wants a different reference tone only has to set
one field. Against Barrington's four fills the new ink measures
**7.9–12.8:1**.

**The halo stays, on purpose, for satellite** — a color swap alone cannot
promise 3:1 against arbitrary photography the way it can against a sheet's
own fixed fills. Measured against real tile colours sampled from the actual
satellite imagery this app renders: the new dark ink reaches only
**1.0–2.3:1** against a dark forest, ocean or mid-green tile, while the pale
halo alone reaches only **1.06–2.10:1** against snow or sandy terrain — each
fails on exactly the backgrounds the other one handles. Drawing both (dark
ink, pale halo underneath) is what actually guarantees one half of the pair
contrasts with whatever a given pixel shows, which is why this is additive
to the halo fix above rather than a replacement for it.

**Reported a fourth time — explicit per-basemap colours, not a shared
compromise: "DARE: dark. satellite: yellow. Vestigian: darker in light mode,
unchanged in dark. Barrington: dark."** `referenceInk` is now set for every
one of the four `BasemapView`s, not just two: `antiquity-dare` and
`antiquity-awmc` get `base.ink` (as above); `vestigian` gets `base.ink` too
but only when `sheetTone.value === 'light'`, since `vestigian` is the one
view where `sheetTone` tracks the reader's real theme instead of being
forced; `satellite` gets a fixed high-visibility yellow
(`SATELLITE_REFERENCE_INK`, `#ffcc00`) instead of a dark tone at all, paired
with a **dark** `haloColour` override (`SiteIconPalette.haloColour`,
`rgba(28, 24, 21, 0.85)`) rather than the default pale one — a light ink
over a light halo fails together against the same pale sand or snow a
photograph can just as easily show, and the two swapped colours were
measured the same way the dark-ink/pale-halo pair above was: the yellow
alone reaches 4.1–11.6:1 against dark forest/ocean/mid-green tiles but only
1.2–2.1:1 against snow/sand/light roofs, the dark halo underneath reaches
5.9–16.5:1 against exactly those light tiles. `#ffcc00` is a deliberate,
requested exception to this app's "one accent, the oxide red" rule — it
exists for legibility over unpredictable photography, not decoration.

**What actually made all three of the reports above land as "nothing
changed" — found only after this fourth report, by instrumenting a live
page rather than trusting another screenshot.** `attachOverlayIcons`'s
`hasImage(siteIconId('other'))` check was written on the assumption that
`map.setStyle()` clears the image registry — restated as fact in this file's
own text above, and never actually verified. It doesn't: `MapCanvas.vue`
calls `setStyle` with no options, which defaults to `diff: true`, and
MapLibre's diffed style swap only reconciles sources and layers, leaving
runtime `addImage` state alone on purpose (images are request-scoped API
state, not part of the style document). Confirmed by patching
`CanvasRenderingContext2D.prototype.stroke`/`fill` in a real page and
watching what colour actually got drawn: switching from Vestigian to
Satellite fired `styledata` and called `attachOverlayIcons` exactly as
expected, but `hasImage('other')` was still `true`, so the whole function
returned before touching a single canvas. **Every `SiteIconPalette` change
this file has ever shipped — the original halo, the filled-icon halo-width
fix, and every colour in this section — was correct code that silently
never ran again after the very first page load.** Fixed by also comparing a
serialised snapshot of the current palette against the last one actually
registered, so a genuine change always re-runs regardless of what MapLibre
did with the old images.

That fix immediately uncovered a second, real bug: `map.addImage` fires
`styledata` **synchronously**, and `keepOverlayThroughStyleChanges` calls
`attachOverlayIcons` on every `styledata`. Without a reentrancy guard, the
very first `addImage` call inside the loop (for `settlement`, the first
`SiteCategory`) re-entered `attachOverlayIcons` while `hasImage('other')`
— the last category in the loop — was still `false`, reopening the gate and
restarting the loop from `settlement` again, forever, without ever reaching
`other`. A debug build logged over 70,000 identical registration calls in
under a minute before `isRegisteringIcons`, a plain boolean set for the
duration of the loop, went in to block re-entry. Neither bug was visible
from a screenshot taken right after a fresh `page.goto` followed by one
basemap switch — which is exactly the shape every verification screenshot
in this file up to this point took — because the _first_ registration on a
freshly loaded page is never gated at all; only a second, real palette
change ever exercised the broken check.

## Overlay popups are a themed card, not text painted on the map

Reported directly: popup text was hard to read — dark-mode text over the
Barrington and DARE sheets (both fixed to a light tone by `resolveSheetTone`
regardless of the reader's theme), and light-mode text over the satellite
view (real photography, sometimes dark underneath). The cause:
`.maplibregl-popup-content` had `background: transparent !important` and no
colour of its own, so the text's colour — inherited from `body`'s
theme-driven `--text-body` — had no fixed contrast against whatever was
underneath. A dark-mode reader got light text with nothing behind it,
floating directly over a light parchment sheet.

Fixed by giving the popup content the same `.leaf` treatment every other
panel in the app already gets: `background-color: var(--surface-raised)`,
`color: var(--text-body)`, `box-shadow: var(--shadow-leaf)`, a real border
radius. Contrast is then against a theme-aware surface token, not against
whatever the map happens to be showing — the same fix works for all three
reported cases (dark-on-light-sheet, light-on-dark-photo) because the card's
own background no longer depends on the basemap at all. `strong`/`a`/the
close button get their own token-based colours (`--text-strong`, `--accent`,
`--text-muted`) rather than inheriting whatever `currentColor` resolves to.

**The close button's own hit target was nearly invisible to a pointer, not
just to the eye.** Reported as "the × doesn't close it, only clicking beside
the icon does" — confirmed live with `getComputedStyle`: the real element
measured **7.6px by 18.8px**, and `padding: 0px`. `maplibre-gl.css`'s
`.maplibregl-popup-close-button` sets no width, height or padding of its
own, relying entirely on the browser's UA default button padding to give the
"×" glyph room to be clicked — and Tailwind's preflight resets every
`button` to zero padding project-wide, stripping exactly that. A real click
aimed at the visible glyph was landing on the map behind the popup instead,
which closes it too (`closeOnClick: true`, the `Popup` default), so closing
looked like it only worked "beside" the button. Fixed by giving the button
an explicit `1.75rem` square target, centred content, and a hover state —
verified by re-measuring the computed style (**28px by 28px** after the
fix) and by clicking 3px off-centre in a real page and confirming the popup
still closes.

## Cache invalidation is version counters, not deletion — nothing to run by hand

Every tile response is cached in Redis/Valkey keyed by coordinates plus a
generation counter (`server/utils/cache.ts`), not by content hash and not
cleared on write. Two independent counters exist, on separate clocks:

- `vestigian:data-version` — bumped by `bumpDataVersion()` whenever a
  revision is approved (`applyRevision`), which is the only writer.
- `vestigian:atlas-version` — bumped only by `pnpm import:atlas` after a
  rebuild, kept separate so a photo approval doesn't invalidate the
  antiquity atlas's unrelated coastline/road tiles, and vice versa.

Bumping the counter doesn't delete old cache entries — it just changes which
key future requests compute, so stale entries age out on their own TTL
(`EX 3600` for a real tile, `86400` for a confirmed-empty one, both set in
`server/api/tiles/[z]/[x]/[y].get.ts`). This means **normal use needs no
manual cache invalidation in production** — every path that changes what a
tile shows already goes through `bumpDataVersion`/`bumpAtlasVersion`.

The one case that needs a manual bump is writing to Postgres from outside
the app — e.g. restoring `scripts/restore-dev-bundle.ts`'s dump directly
onto a database whose tiles are already cached. Nothing in that path calls
either bump function, so do it by hand once, against the same Redis/Valkey
instance the app uses: `INCR vestigian:data-version` and
`INCR vestigian:atlas-version`. Skipping this doesn't corrupt anything —
Postgres and Redis are just out of step until the existing TTLs expire — but
readers see stale tiles for up to an hour in the meantime.

A bump failure (Redis unreachable) is caught and logged as an error
(`'tile cache not invalidated: approved changes may not reach the map'`)
rather than thrown, per the project's fail-open convention for caches — but
nothing surfaces that failure to the moderator who approved the edit, so if
approvals stop reaching the map, check for this log line before assuming
the revision pipeline itself is broken.

The offline service-worker cache (`service-worker/sw.ts`) is unrelated to
either counter — it is per-visitor Cache Storage, written only by that
visitor's own explicit "download this area" action, so there is no
production-side invalidation for it at all.

## A missing SDF glyph range 404s cleanly now — it used to fall through to a full SSR page render

Reported: the server log filled with `[Vue Router warn]: No match found for
location with path "/fonts/Noto%20Sans%20Regular/11520-11775.pbf"` alongside
the matching browser-console 404s and MapLibre's "Rendering codepoint ...
locally instead" fallback message.

The 404 itself is correct and intentional — see the `RANGES` comment in
`scripts/build-glyphs.ts`. Only nine of the 256 possible ranges are rendered
and committed (Latin, Greek, Cyrillic and their extensions, plus the
punctuation/letterlike blocks the imported titles actually use); anything
else — Hebrew, Georgian, the Cyrillic-Supplement/Armenian block, Arabic —
was deliberately never generated, because MapLibre's own fallback for a
missing range is to render that codepoint from the reader's local system
font, and a range file full of glyphs nobody asked for would cost 200+ KB
each for scripts this atlas's data barely touches.

What was not intentional: Nitro serves an existing file under
`public/fonts/` directly and fast, but a _missing_ one used to fall through
past that static-asset handler with nothing else registered for `/fonts/`,
landing on Nuxt's SSR page renderer as the last resort. That renderer asks
Vue Router to match `/fonts/Noto Sans Regular/11520-11775.pbf` as a page
route, fails, logs the warning, and only then produces a 404 — a full SSR
pass spent on every single unshipped glyph range MapLibre asks for, once per
range per session, purely to arrive at the same status code a static
handler would have returned for free.

Fixed with `server/routes/fonts/[...path].get.ts`, an explicit handler that
throws a plain 404 immediately. It never intercepts a range that actually
exists — Nitro's static-asset serving still answers those first and
terminates the request before any custom route is consulted, confirmed by
curling both an existing (`0-255.pbf`, `200`) and a missing (`1280-1535.pbf`,
`404`) range after adding the route. Verified again after `pnpm check`: 434
tests, lint, typecheck and format all clean.

## Toggling an overlay didn't always redraw the map until the reader scrolled

Reported directly: "show battles" (and, plausibly, any overlay) sometimes
drew nothing when switched on, and only appeared once the reader panned or
zoomed the map. Attempted reproduction in a real Chromium instance against
the dev server — toggling immediately after load, after an 8-second idle
period, at the default zoom, with screenshots taken as early as 100ms after
the toggle — never once reproduced it; the layer painted correctly every
time. That does not mean the report was wrong, only that whatever condition
triggers it (production network latency, a throttled/backgrounded tab, an
OS-level power-saving mode affecting `requestAnimationFrame` scheduling) is
not present in a fast, foregrounded, local Chromium session, and none of
those were reproducible here (the same class of environment gap the offline
feature's throttling attempt hit — see "Offline maps" below).

**The fix applied is defensive, not diagnostic**: every overlay's
`attach*Overlay` now calls `map.triggerRepaint()` immediately after its
`addSource`/`addLayer` calls (`useLimesOverlay`, `useBattleOverlay`,
`usePortOverlay`, `useRouteOverlay`, `useMinorFeatureOverlay`,
`useCoinHoardOverlay`, `useViewportTiles`, `useTabulaPeutingerianaOverlay`,
`useNotebookOverlay`). MapLibre stops its internal render loop once idle and
is _supposed_ to resume it on its own when a source or layer is added, but
`triggerRepaint()` is the library's own public escape hatch for exactly this
"I changed the style, make sure a frame gets scheduled" case, and calling it
is free when a repaint was already going to happen regardless. If this
report recurs, the next step is capturing it live (screen recording or a
production-network repro) rather than more local Playwright attempts, since
local reproduction has now been tried and failed twice.

## Every overlay credits its own source, and shipped without doing so

`attribution` is set on each overlay's own MapLibre source
(`useLimesOverlay`, `useBattleOverlay`, `usePortOverlay`, `useRouteOverlay`,
`useMinorFeatureOverlay`, `useCoinHoardOverlay`,
`useTabulaPeutingerianaOverlay`), with the strings themselves in
`useBasemapStyle.ts` beside the basemap credits that were already there.
`AttributionControl` collects from the sources currently in the style, so a
credit appears with its layer and leaves with it — which is the right
granularity for switchable layers and is asserted end to end in
`e2e/basemap.spec.ts` ("credits an overlay source while that overlay is
switched on"), both directions.

**None of them had one.** For four of these sources attribution is the
licence condition itself — de Graauw's ports are CC BY 4.0, ORBIS CC BY 3.0,
CHRR CC BY-NC-SA 4.0, AWMC's minor antiquities ODbL 1.0 — so this was a
licence breach, not a polish item. It was invisible while the vici site
overlay was on by default, because that source carried the one credit line
(`useViewportTiles`) everything else was silently leaning on; switching it
off (below) left a map with ports, routes and coin hoards drawn on it and
"© OpenStreetMap contributors" as the entire credit. Wikidata's battles and
OpenHistoricalMap's extents are CC0 and compel nothing; they are credited on
the same terms anyway, for the reason `EMPIRE_EXTENT_ATTRIBUTION` gives.

`LIMES_ATTRIBUTION` was folded into the antiquity sheet's `atlas` source and
is now the frontier's own, self-contained: the frontier draws over basemaps
that have no `atlas` source at all, so appending it there credited AWMC
exactly where the credit was not needed and nowhere it was.

## Overlays are their own control, not a group inside the basemap menu

`OverlaySwitcher.vue` sits beside `BasemapSwitcher.vue` in the map's control
row. The switches lived inside the basemap menu because they began as
readings of one particular sheet; none of them is any more, so a reader
looking for "show me the ports" was opening a menu named after the thing
they were not changing and scrolling past two groups of radio buttons to
reach a checkbox at the bottom of it. The closed button carries a count,
because with the panel shut nothing else on screen says how many layers are
drawn — several of them (routes at low zoom, coin hoards outside Italy) are
easy to leave on without noticing.

The period scrubber and the Tabula Peutingeriana viewer link stayed in the
basemap switcher: the scrubber redraws the antiquity sheet itself and only
exists while that sheet is showing, and the viewer link is another way of
looking at the map rather than a layer over it. The i18n keys did **not**
move — the toggles are still `basemapSwitcher.show*`, since renaming ~16
keys across six catalogues buys nothing a reader can see.

e2e reaches the toggles through `openOverlays`/`toggleOverlay`
(`e2e/helpers/map.ts`), never through the basemap button.

## The vici-sourced site/tracing overlay is off by default

`isShowingSites` (`useBasemapStyle.ts`) gates `OVERLAY_SOURCE_ID`
(`useViewportTiles.ts`) — `false` on every fresh visit, not persisted, same
as `isLimesActive`/`isBattlesActive`. Toggled from `OverlaySwitcher.vue`
("Show sites"), same shape as the frontier and battle switches.

**Why:** this was the one overlay with no on/off state — it requested tiles
on every first visit regardless of what the reader actually wanted to look
at, unlike the limes, battles, Tabula Peutingeriana overlay and period
scrubber, which were all already gated.

**What was actually measured, not guessed:** on a local, unthrottled
connection, turning "Show sites" off removes the site/tracing tile requests
entirely until the switch is used — 0 requests / 0 bytes vs. 12 requests /
~14.5 KB for the same default camera view with it on. It does **not** move
`mapReadyMs` (when MapLibre fires `load` and the "Unfolding the map"
placeholder is removed): that milestone was never blocked by the overlay's
tiles even before this change — `attachOverlay` requests them
asynchronously, after `load`, the same way every other overlay's tiles are
requested. The real saving is fewer concurrent requests and less data
during the page's busiest window, not a faster "map ready" event — reported
this way rather than as an invented "N ms faster" claim, since the number
that would need to move to support that claim did not move on a fast local
connection with near-zero latency. A throttled (CDP
`Network.emulateNetworkConditions`) measurement was attempted but the
emulation did not visibly take effect against a localhost target in this
environment (identical request/byte counts with the toggle on and off,
which the unthrottled comparison already contradicts) — not reported as a
number for that reason, rather than papering over the discrepancy.

**Known coupling, not fixed here:** `LIMES_FORT_LAYER_ID` (the contributed
fortifications drawn on the frontier) reads `OVERLAY_SOURCE_ID`'s `sites`
source-layer, same as every other site layer. Turning "Show sites" off also
removes those forts from the map while "Follow the limes" stays on — the
frontier line itself and its borrowed Pleiades military-place marks (drawn
from the separate `limes`/`atlas` sources) are unaffected, only the
contributed forts. Splitting the fort layer into its own source was judged
out of scope for a performance toggle; if it becomes a real complaint, that
split is the fix, not a workaround bolted onto this gate.

`findFeaturesAtPoint` filters its `queryRenderedFeatures` layer list to
layers that currently exist (`map.getLayer(id)`) — MapLibre throws for an
unknown layer id rather than returning nothing, and every layer it queries
lives in `OVERLAY_SOURCE_ID`, absent while the toggle is off. Icon
registration (`registerSiteIcons`/`registerAtlasIcons`/`registerLimesIcons`/
`registerBattleIcon`) was pulled out of `attachOverlay` into its own
`attachOverlayIcons`, called unconditionally on `load` and on every
`styledata`, before any overlay's `attach*` call — the frontier and battle
marks are drawn from that same registry and both can be switched on while
"Show sites" itself stays off.

## A nullable numeric property in an MVT tile arrives as `undefined`, not `null`

Found building the inscriptions overlay (`.claude/rules/epigraphy.md`), but
general to any layer that puts a nullable numeric column into a tile and
reads it back client-side: MVT has no null type, so `ST_AsMVT` simply omits
a NULL column from that feature's properties. A real browser decoding the
tile then sees `undefined` for that property, not `null` — and code written
against `| null` types (every date/period helper in this codebase, written
against real Postgres reads elsewhere) can take a wrong branch on
`undefined === undefined` before its own `=== null` checks ever run. Caught
live: a fully undated inscription's map popup rendered a bare "AD" instead
of "Undated", because `formatPeriod`'s exact-year branch matched on both
fields being `undefined` first. The fix belongs at the tile-properties
boundary — normalise with `?? null` right after reading `feature.properties`,
before handing values to anything typed `number | null` — not inside the
shared formatting helper, which is correct for every other caller.

## The period scrubber's thumb was never named — a template ref typed as an array that was not one

`PeriodSwitcher.vue` sets the slider's accessible name imperatively, because
Nuxt UI's `<USlider>` forwards `aria-*` only to `SliderRoot` and never to
`SliderThumb`, which is the element actually carrying `role="slider"`. That part
of the reasoning was right. The lookup was not:

```ts
const periodSlider = useTemplateRef<{ $el?: HTMLElement }[]>('periodSlider')
const sliderRoot = periodSlider.value?.[0]?.$el // always undefined
```

A template ref resolves to an **array** only when it sits inside a `v-for`.
There is no `v-for` here, so `periodSlider.value` is a single component
instance, `[0]` is `undefined`, and the guard below it returned early on every
run. The thumb was rendered and left permanently unnamed, from the moment the
code was written — a screen reader announced an unlabelled slider, and
`getByRole('slider', { name: … })` could not match it either.

Two lessons worth keeping separately:

- **It was found by a test that had never passed, not by review.** The e2e
  assertion was written against the intent and the implementation never met it;
  nobody noticed because the failure sat behind a scrubber nothing else touched.
- **Verify a DOM claim against the DOM.** The original docstring said the
  behaviour was "confirmed by reading both components' source, not assumed" —
  and it was, for the part about `SliderRoot`. The wrong bit was a shape
  assumption about Vue's own ref, which one `page.evaluate` dumping
  `document.querySelectorAll('[role="slider"]')` settled immediately: the thumb
  was present, enabled, and its `aria-label` was simply `null`.

The watcher is also now `watch(..., { flush: 'post' })` with the step count as
an explicit source, rather than `watchEffect` — the effect could otherwise run
before the DOM was patched and never re-run, since the only reactive value it
touched afterwards (`periodSliderLabel`) reads "Off" both before and after the
fetched steps arrive, and an unchanged computed re-triggers nothing.

## MapLibre v6 is ESM-only, and a bundler needs `setWorkerUrl()` or the map silently renders nothing

The bump from 5.24.0 to 6.9.0 closed GHSA-jrc7-96c5-q579 (CVSS 10.0): `DOM.sanitize()`
iterated `elem.attributes` — a _live_ `NamedNodeMap` — while calling
`removeAttribute()` in the same loop, so removing one attribute shifted the rest
down an index and the iterator skipped the neighbour. `<details open onload="1"
ontoggle="…">` therefore lost the first handler and kept the second, which then
ran on insertion into the attribution control's `innerHTML`. Zero-click XSS, for
anyone rendering untrusted attribution.

**This application was at the narrow end of that.** Every `attribution` value in
the style is a module constant or a string literal — checked, not assumed — and
the database's own `sites.attribution` is rendered on record pages, never handed
to MapLibre. The one path that existed was a third-party TileJSON
(`tiles.openfreemap.org/planet`, Mapterhorn, EOX) serving a hostile attribution
string, which is a compromised-upstream scenario rather than a visitor-supplied
one. Real, but narrow.

The upgrade itself is small here because almost every import in this repo was
already named or type-only. Three files used the default import
(`import maplibregl from 'maplibre-gl'`), which v6 does not publish; they now
name what they use (`addProtocol`, `MapMouseEvent`, `GeoJSONSource`).

**The part that is not optional is `app/plugins/maplibre.client.ts`.** v6 is
ESM-only and resolves its worker from `import.meta.url`, which does not survive a
bundler's module graph — so under Vite, webpack and the rest every consumer must
call `setWorkerUrl()` once, or no vector tile ever loads. v5 needed no such call,
so there is no older equivalent this grew out of.

Two details in that file are load-bearing:

- **`?worker&url`, never plain `?url`.** The dist worker imports its sibling
  `maplibre-gl-shared.mjs`; `?url` emits the worker file verbatim in a
  production build _without_ that sibling, so it dies on its first import.
  Dev mode works either way, which is exactly how this would have shipped
  broken. Verified against the built output: the emitted chunk is 496 KB and
  contains zero references to `maplibre-gl-shared`.
- **A client plugin, not module scope in `useMapInstance`/`useBasemapStyle`.**
  `?worker&url` is a Vite transform that fails under vitest's plain-node
  environment, and both of those modules are imported directly by their unit
  tests.

Nothing else in v6's breaking list touches this repo, each checked rather than
assumed: no `map.transform`, no `styleimagemissing` listener, no `JSON.parse` of
GeoJSON feature properties (both call sites read `localStorage`), no use of
MapLibre's own `Hash` control (`readCameraFromHash` is this project's own
parser), and `setData` is called with one argument and its return value ignored.
CSP already allowed `worker-src 'self'`, which is all a self-hosted worker needs.

## How the map stays fast

1. `GET /api/tiles/{z}/{x}/{y}.mvt` → validate coordinate → check Valkey → `ST_AsMVT` against a GiST index.
2. **Below zoom 9**: counted clusters, snapped to a grid in _projected_ space (square cells at every latitude). **At 9+**: individual sites. **Tracings from zoom 7**, simplified with a tolerance derived from metres-per-pixel.
   **Individual-markers mode:** `SiteDensityToggle` (floating button, bottom right, only while "Sites" is on) flips `isClusteringSites` (`useBasemapStyle`, not persisted). Off-cluster, the source's tile URL gains `?sites=all` (`refreshSiteClustering` detaches and re-attaches the overlay — `VectorTileSource.setTiles` was tried and left the current zoom's tiles undrawn until the zoom changed), the server answers every zoom with `feature` tiles (`planTileRender(z, { showEverySite })`), and the cluster layers are built hidden. Below zoom 9 those tiles drop `slug` and `period_*` (`compactSiteProperties`) — they carry the whole continent's points. Cache key gains `:every`. **Unmeasured:** payload at zoom 3–5 on the full 61k-site import; `icon-size` has extra stops at zoom 4/6 so the markers are not a solid smear. Not covered by offline areas — an offline pack downloads the clustered URLs only.
3. Tiles carry `id`, `slug`, `title`, `category` **only**. Descriptions and images come from `/api/sites/:id` on demand — this keeps tiles small and cacheable far longer than editable content allows.
4. Cache invalidation is **one counter**. `bumpDataVersion()` changes the key prefix for every tile at once. Approvals are rare; tile reads are not.
5. Empty tiles are cached for 24h — most of the pyramid is ocean.

After any deploy or bulk import, run `pnpm tiles:warm <url>`.

## Offline maps — how large, and what actually got measured

The map was never available with no signal — "installable as a PWA" meant a
manifest and nothing else, no service worker anywhere. Before building
anything, the real question was answered by measuring, not guessing: sampling
real tile sizes across the whole import bbox (`-12…45°E, 30…62°N`, the same
box `04-mirror-basemap-tiles.ts` uses) showed the three vector layers this app
draws itself — contributed sites/tracings, the Barrington antiquity sheet, the
limes — total **under 50 MB for the entire continent** through zoom 10.
Individual tiles run 0–1,150 bytes; "most of the pyramid is ocean" (see "How
the map stays fast") held up under measurement. The basemap is the one
expensive part: DARE's raster mirror is a measured 1.2 GB (see "Antiquity
basemaps"), and the modern PMTiles archive for a region this size is
plausibly multiple gigabytes — not measured directly, since no
`NUXT_PUBLIC_BASEMAP_PMTILES_URL` exists in dev, and that absence is stated
rather than papered over with an invented number.

That split is why offline is a **bounded, explicit download**, never "make
the whole atlas available offline": a reader downloads whatever area is on
screen, at one of three detail tiers (Overview z8, Regional z11, Detailed
z13), optionally including a slice of the basemap. A single area is
realistically low tens of MB, not gigabytes.

**The mechanism is one Service Worker with two halves that never overlap.**
`service-worker/sw.ts` (built by `@vite-pwa/nuxt`'s `injectManifest`
strategy, not `generateSW` — the bulk-download-with-progress flow is
application logic no declarative routing config expresses) precaches the app
shell so the interface itself loads with no network, and answers the four
tile-route families from Cache Storage **only when a match already exists**.
It never writes to a cache itself. The only writer is
`app/composables/map/useOfflineAreas.ts`'s `download()`, called from the map's
"download this area" control — so an offline area is a precise, bounded,
user-initiated fact, never something casual browsing silently grows. Both
sides agree on tile URLs and cache names through
`shared/utils/offline-cache.ts` and `shared/utils/tiles.ts`, imported nowhere
else — the service worker is bundled by a separate Rollup pass from Nuxt's own
Vite instance, and `srcDir` in `nuxt.config.ts`'s `pwa` block has to be an
absolute path for the same reason: it resolves against `nuxt.options.srcDir`
(Nuxt 4's `app/`), not the project root, and this repo keeps non-Nuxt code —
`server/`, `shared/`, now `service-worker/` — at the top level to match
`scripts/` and its own `tsconfig.scripts.json`.

**The estimate shown before a download is a real, sampled measurement, not a
guess.** `useOfflineAreas.estimate()` fetches ~20 evenly-spread real tiles per
layer — the same URLs the download itself will fetch — and extrapolates from
their measured size. `navigator.storage.estimate()` backs the quota warning,
with a 20% margin since the estimate is itself a sample.

**The production basemap needed a second, smaller piece.** Production's
basemap is not individual tile URLs — it's one PMTiles archive read via HTTP
range requests, registered as a `pmtiles://` MapLibre protocol that the
browser reads directly from Bunny/R2. Caching that the normal way would mean
caching the whole archive (the multi-gigabyte figure above), not a bounded
area. `server/api/tiles/basemap/[z]/[x]/[y].get.ts` reads individual tiles out
of the archive server-side, via the `pmtiles` npm package's `PMTiles.getZxy`
(the same package the client already uses, now also used from Node — Nitro's
global `fetch` and Node 22's global `DecompressionStream` are what make that
work with no new runtime dependency). **Normal map viewing never calls this
route** — it exists solely so the download flow gets one ordinary, cacheable
HTTP response per basemap tile. 404, not 204, when no archive is configured:
an empty ocean tile is a normal outcome worth caching quietly, but "this
deployment has no offline basemap capability" is a different fact the
download flow needs to be able to tell apart from it.

Two bugs, both found only by actually going offline in a real browser, not by
typechecking or reading the code:

1. **A newly activated service worker does not control pages already open —
   standard platform behaviour, not a bug in the platform.** Without calling
   `clientsClaim()` (`workbox-core`), a reader who downloads an area and loses
   signal in the _same_ session, without reloading, got no offline serving at
   all: the very case this feature exists for. Found because the first e2e
   attempt at "go offline, refetch a just-downloaded tile" failed with a
   genuine network error even though the tile was verifiably sitting in Cache
   Storage.
2. **`useState`'s factory runs once, during SSR, where `import.meta.client` is
   false — Nuxt then serialises _that_ result into the payload and hydrates
   the client from it rather than re-invoking the factory.** A conditional
   inside the factory reading `localStorage` "on the client" therefore never
   actually ran client-side: it read `[]` on the server and the client
   inherited that `[]` permanently. `useOfflineAreas` now always starts empty
   and exposes `refresh()`, which every page that displays the list calls
   `onMounted`. The same bug would have silently discarded previously
   downloaded areas the first time `download()` ran in a session that had
   never called `refresh()` — its write path reads fresh from `localStorage`
   rather than trusting `areas.value`, for exactly that reason.

**Licence:** a bounded download of Vestigian's own vector layers carries no new
question — same CC BY-SA / CC0 as everything else at `/api/data/sites.geojson`.
A basemap slice is OpenStreetMap data via the operator's own PMTiles archive,
attributed the same way the live map already attributes it.

## `useBasemapStyle.ts` was written against one vector tile schema; production serves another

Reported directly: city names missing from both the `vestigian` and `satellite`
views. For `vestigian` this was a real regression with a precise cause; for
`satellite` the layer had never existed at all — two different things arriving
as one report, the same shape as the `atlas-places` click-handling report
above.

**The regression.** `buildBasemapLayers`'s `place-labels`/`buildings`/
`roads-minor`/`roads-major`/`boundaries` layers hardcode OpenMapTiles/Tilezen
`source-layer` names (`place`, `building`, `transportation`, `boundary`) and a
`class`-based road filter — correct for `tiles.openfreemap.org/planet`, the
`openfreemap` provider dev always uses. Production's `pmtiles` provider reads
a Protomaps `build.protomaps.com` extract instead (see "Antiquity basemaps" /
the deployment runbook's PMTiles section), whose own "basemaps" schema
(confirmed against docs.protomaps.com/basemaps/layers, v4 — this is stated
there explicitly as Tilezen-_derived_, not OpenMapTiles-compatible) names the
same five things differently: `places`, `buildings`, `roads`, `boundaries`
(plural throughout, versus OpenMapTiles' singular), a two-tier `kind`/
`kind_detail` road classification instead of one `class` string, and a
`kind: 'country'` boundary tag instead of a numeric `admin_level`. A
`source-layer` or filter that matches nothing is not an error in MapLibre —
the layer is simply empty, silently — so every one of those five layers went
blank in production the moment `NUXT_PUBLIC_BASEMAP_PROVIDER=pmtiles` was set,
and nothing short of comparing dev against production by eye would show it.
Labels were the one the report named because they're what a reader actually
reads; roads, buildings and boundaries were equally gone underneath.

Fixed with `ModernSchema` — the layer-name and filter differences pulled into
one small table per provider (`OPENMAPTILES_SCHEMA`/`PROTOMAPS_SCHEMA`),
selected by `source.provider` via `resolveModernSchema()` and threaded through
`buildBasemapLayers`'s new third parameter. `landuse` and `water` were left
alone — both schemas happen to agree on those two names, confirmed against
the same reference page rather than assumed from the other three agreeing by
coincidence.

**The non-regression.** `satellite` never had a `place-labels` layer at any
point in this file's history (`git log -p`, back to the commit that added the
view) — it draws raster imagery and nothing else, so there was nothing to
regress. What the report actually wanted, and what "slightly transparent
modern city names" in the same report describes exactly, is the same layer
`vestigian` already draws at its quiet `0.7` opacity, added to `satellite`
too. Pulled the layer definition into its own `buildPlaceLabelsLayer()` so
both views share one source of truth rather than the satellite copy drifting
from the vestigian original the next time either changes; `buildSatelliteStyle`
gains a second source (`basemap`, the same `buildVectorSource()` every other
view uses) purely to feed it, and now also calls `registerPmtilesProtocol()`
for the `pmtiles` provider — previously only the vestigian branch of
`buildBasemapStyle` did, because it was the only view that needed a
`pmtiles://` URL at all.

Verified with `useBasemapStyle.test.ts`: one assertion per schema confirming
`vestigian` reads `place`/`building`/`transportation`/`boundary` under
`openfreemap` and `places`/`buildings`/`roads`/`boundaries` (plus the
`kind_detail`/`kind` filters) under `pmtiles`, and two more confirming
`satellite` now carries a `place-labels` layer reading the correct
`source-layer` name for whichever provider is active. 31 tests pass, `tsc`
and `eslint` both clean.

## A fifth basemap view: the familiar OSM look — two passes, the second one reading the actual source

Asked directly: find an OpenStreetMap-style basemap — mirrorable, open
source, EU-based, linked otherwise — that makes the map "look like vici.org
does", and add it as another view if one exists.

**Provider research (stayed correct across both passes).** Checked rather
than assumed, same standard this file already holds third-party sources to
elsewhere:

- **What vici.org's own map actually is.** Fetched `vici.org` directly
  first (`curl`, not memory): its `ViciWidget` config sets `defaultMap:
"OSM"` with no matching `extraMaps` entry, which read as OpenLayers' own
  built-in `ol.source.OSM` — the standard `tile.openstreetmap.org` raster
  layer, hotlinked directly. **That reading was incomplete.** Asked a
  second time against a specific `vici.org` URL, watching the real tile
  requests a loaded page actually makes (Playwright, not the HTML source)
  showed the true answer: `tiles.vici.org/osm/{z}/{x}/{y}.png` — `vici.org`
  mirrors the classic OSM-Carto raster render **itself**, rather than
  hotlinking `tile.openstreetmap.org`. The HTML alone understated what the
  page does; a page actually has to be run to know.
- **OpenFreeMap — already this project's own dev provider.** MIT licensed,
  self-hostable, public instance on two Hetzner machines (Germany) —
  "EU-based" and "mirrorable" together, and for data this project already
  mirrors: no new provider, no new licence question, no new hosting
  dependency for either dev (`openfreemap`) or production (the self-hosted
  Protomaps PMTiles extract already described above).
- **The literal route — running `gravitystorm/openstreetmap-carto`
  itself** (the actual CartoCSS stylesheet behind `tile.openstreetmap.org`
  and what `vici.org` mirrors) **— was not taken.** It is a Mapnik/CartoCSS
  _raster_ stylesheet: its own `osm2pgsql` import into PostGIS plus a
  `renderd`/`mod_tile` process actually rendering tiles, i.e. exactly the
  tile-server process this project's PMTiles architecture exists not to
  need (see the stack table in `CLAUDE.md`). What's built instead reads the
  same already-mirrored vector source every other view draws and recolours
  it with that stylesheet's own published colour values — mirrorable in
  the sense that matters here (no new provider, no new hosting
  commitment), open source (CC0), EU-based (OpenFreeMap's own instance).

**First pass used invented, memory-approximated colours and was reported as
not matching.** `OSM_STANDARD_COLOURS` originally held a muted palette
loosely "modelled on `maputnik/osm-liberty`" from a web search summary, not
the real file — and the summary itself was wrong in places (it returned
icon colours when asked about the fill palette). Reusing the shared
`buildBasemapLayers`/`StyleColours` plumbing meant exactly one landuse wash
and one two-tier road split, with no forest/grass layer at all. Against the
actual report — a `vici.org` URL, screenshotted and compared directly —
the gap was obvious and specific: the reference is dominated by a
saturated green forest/grass fill this build had no layer for whatsoever,
and a four-colour cased road hierarchy (red motorway, orange primary, pale
yellow secondary, white local) where this build drew one flat beige line.

**Second pass reads real values out of the actual stylesheet, not another
approximation.** Fetched `gravitystorm/openstreetmap-carto` directly —
`style/style.mss` (land `#f2efe9`, water `#aad3df`), `style/landcover.mss`
(forest `#add19e`, grass `#cdebb0`), `style/road-colors-generated.mss`
(motorway fill `#e892a2`/casing `#dc2a67`, primary `#fcd6a4`/`#a06b00`,
secondary `#f7fabf`/`#707d05`, local `#ffffff`/`#8f8f8f`), `style/
buildings.mss` (`#d9d0c9`), `style/admin.mss` (`#8d618b`) — every value in
`OSM_STANDARD_COLOURS` and `buildOsmStandardStyle`'s road tiers is one of
theirs now, not a guess at one.

**This needed its own layer builder, not the shared `buildBasemapLayers`.**
That function draws one undifferentiated `landuse` wash and a two-tier
road split — right for `vestigian`'s deliberately quiet sheet, but the
actual shape of the first attempt's gap: OSM-Carto's look depends on a
forest/grass fill and a four-tier coloured-and-cased road hierarchy
neither of which fits that function's shape. `buildOsmStandardStyle` now
draws its own layer list — `landuse` (generic wash) → `vegetation` →
`forest` → `water` → `waterway` (river/stream lines — a real second gap
found only by comparing the render against the reference a second time,
see below) → `buildings` → four road tiers, each a casing line under a
fill line via `buildRoadTierLayers` → `boundaries` → labels — reusing only
`buildVectorSource`/`resolveModernSchema`/`buildPlaceLabelsLayer`, the
parts that are genuinely shared facts about the source rather than
opinions about how to draw it. `ModernSchema` grew the fields this view
needs (`landcover`/`forestFilter`/`vegetationFilter`, four road-tier
filters, `waterwayLayer`/`waterwayFilter`) rather than a second interface,
since they are exactly the same kind of per-provider fact the existing
fields already record — `vestigian`/`satellite` are unaffected, they just
don't read the new fields.

**Three provider-schema asymmetries, each found by actually comparing a
render against the reference rather than trusting the plan:**

- **Forest/grass live in a different _layer_, not just a differently-named
  one.** OpenMapTiles carries a dedicated `landcover` layer at every zoom.
  Protomaps' own `landcover` layer only goes to z7 (continental scale, its
  own docs say so) — at the zooms this atlas is actually read, forest/grass
  has to come from Protomaps' `landuse` layer's `kind` field instead, the
  same source-layer the generic wash already reads.
- **Rivers live in a different layer too.** OpenMapTiles keeps them in
  their own `waterway` layer. Protomaps' own docs state its `water` layer
  carries "polygons, lines and point labels" together — so the line
  geometry is read from the _same_ layer as the lake/sea fill, filtered to
  the linear `kind_detail` values. Found by comparing a rendered screenshot
  against the `vici.org` reference a second time after the colour fix
  landed: the reference's Aniene valley shows a clear blue river thread
  this build had no layer drawing at all, since nothing reads `waterway`
  anywhere else in this file.
- **A real, shipped bug, caught by the render, not the type checker:**
  `buildRoadTierLayers`'s `source-layer` was hardcoded to `'transportation'`
  — correct for OpenMapTiles, silently wrong for Protomaps (`'roads'`).
  `tsc` and `eslint` were both clean; the existing per-provider schema test
  (now asserting `roads-motorway-fill` rather than the old single
  `roads-major`) caught it the moment it was updated to the new layer ids.
  Fixed by threading `schema.transportation` into the builder instead of a
  literal.

**One MapLibre validation trap, caught live in a browser, not by any static
check:** `waterwayFilter` is `undefined` for OpenMapTiles (the whole
`waterway` layer is already nothing but river lines, nothing to filter
out), and writing `filter: schema.waterwayFilter` straight into the layer
object set that key to a literal `undefined` — which MapLibre's style
validator rejects outright (`"layers[5].filter: array expected, undefined
found"`), silently breaking every view the instant `setStyle` ran, caught
only by loading the page and reading the console, not by `tsc` (`filter?:
FilterSpecification` happily accepts `undefined` as a value, which is not
the same thing MapLibre's own runtime validator accepts). Fixed by
spreading the key in conditionally (`...(schema.waterwayFilter ? {filter:
...} : {})`) so the property is _absent_ for OpenMapTiles rather than
present-and-undefined.

Fixed to a light sheet regardless of theme (`resolveSheetTone`), the same
treatment DARE/Barrington/satellite already get: there is no authoritative
"OSM dark mode" to defer to. Reference-mark contrast needed no new
per-view case in `useViewportTiles.ts`'s `palette` — measured, not assumed:
`base.ink` (`#2b2621`) against `OSM_STANDARD_COLOURS`'s main fills comes
out at 9.3–13:1, comfortably past the 3:1 floor `haloOnRaster`/
`referenceInk` exist to guarantee for satellite/DARE's actual photography —
this view's fills are flat and known, like Barrington's, not per-pixel-
unpredictable like a raster, so the existing default already covers it.

No template change was needed in `BasemapSwitcher.vue` — it already
iterates `availableViews` generically by group, so a fifth `BasemapOption`
with `group: 'today'` appears automatically. Its `label`/`hint` stayed
plain English strings, matching the other four entries in `BASEMAP_VIEWS`:
that whole array has never been run through `t()` (confirmed by grepping
for a matching `basemapSwitcher.view*` key — none exists), a pre-existing
i18n gap this change did not introduce and did not fix, to avoid a
one-entry inconsistency or an unrelated refactor neither was asked for.

Verified end to end: `useBasemapStyle.test.ts` carries 11 cases for this
view (own colour table, OSM-Carto's real road colours by hex value, the
forest/vegetation fill, the cased-pair road construction, the waterway
schema asymmetry, both providers' source-layer names, fixed sheet tone,
the group assignment), 650 tests pass, `tsc`/`eslint`/`prettier` clean, and
a real dev-server render at the exact coordinates the `vici.org` reference
used (Subiaco, Lazio) plus a Munich city-scale render confirm the result —
dominant green forest, a visible river thread, a red/orange/yellow/white
cased road hierarchy — against both the reference screenshot and a second,
independent smoke test switching through all five views with the browser
console watched for errors.

## Named-feature labels on `osm-standard` — investigated before building, one category dropped by design

Asked next: mountain names and their height, caves, river names, road
names, "and so on, like existing on OSM" — and explicitly told to
investigate and report back before writing any code. Checked both
providers' real schemas rather than their docs' summaries:

- **Peaks carry elevation in OpenMapTiles, not in Protomaps at all.**
  OpenFreeMap's real TileJSON (`https://tiles.openfreemap.org/planet`) has
  a dedicated `mountain_peak` layer: `name`, `ele` (metres), `ele_ft`,
  `class` (peak/volcano/saddle/ridge/cliff/arete), `rank`. Protomaps' own
  docs (docs.protomaps.com/basemaps/layers) have no `ele`/elevation field
  anywhere on the page — a peak there is only a `pois` point with
  `kind: 'peak'` and a name. **Decision, on request: name only, in both
  providers, so dev and production never visibly disagree about this
  feature** — not a limitation forcing the choice, a deliberate levelling
  once the limitation was found.
- **Caves are absent from both schemas entirely — a data gap, not a
  styling one.** Checked OpenMapTiles' actual `layers/poi/poi.yaml` source
  (not its rendered docs page): the POI layer's `subclass` passthrough only
  forwards `amenity`/`barrier`/`historic`/`information`/`landuse`/
  `leisure`/`railway`/`shop`/`sport`/`station`/`religion`/`tourism`/
  `aerialway`/`building`/`highway`/`office`/`waterway`/`zoo` tags —
  `natural` (what `natural=cave_entrance` is tagged under) is not one of
  them, so cave entrances are dropped before the tiles are even built.
  Protomaps' docs don't mention caves anywhere either. **Decision, on
  request: dropped entirely, not tracked as a follow-up** — surfacing
  caves would mean a new OSM import with its own table and tile endpoint
  (the same shape as the AWMC minor-features import), a materially bigger
  task than a label, and out of scope here.
- **Rivers and roads both need a _name_ field the already-drawn geometry
  layer doesn't carry, in OpenMapTiles specifically.** Confirmed directly
  against the real TileJSON: `transportation` (the line geometry
  `roads-*-fill`/`-casing` already read) has no `name` field at all — road
  names live in a separate `transportation_name` layer. `waterway` (the
  river lines already drawn) does carry `name` directly, so no second
  layer was needed there. Protomaps keeps `name` on `roads` directly via
  its common-tag schema (no separate names layer exists for it at all —
  confirmed against the full id-anchor list of every section on
  docs.protomaps.com/basemaps/layers: boundaries, buildings, earth,
  landcover, landuse, places, pois, roads, transit, water — nothing
  resembling a `roads_name`). Lake/sea names are the same shape as roads:
  a separate `water_name` layer in OpenMapTiles, but Protomaps' own docs
  state its `water` layer already carries "polygons, lines _and point
  labels_" together — the labels are read from the exact source-layer the
  fill and the river lines already use.

`ModernSchema` grew `peakLayer`/`peakFilter`, `roadNameLayer`, and
`waterNameLayer` to carry these per-provider facts, the same shape its
existing `landcover`/`waterway` fields already used — not a second
interface, since this is exactly the kind of fact the first one already
exists to record.

**`buildNamedFeatureFilter(extra?)` exists because of a bug this exact
file already shipped once.** Writing `filter: schema.someOptionalFilter`
straight into a layer literal is what broke `waterway` earlier in this
same build (see above) — when the optional filter is `undefined` for one
provider, MapLibre's validator rejects the literal `undefined` value
outright rather than treating it as an absent key, and `tsc` cannot catch
it because `filter?: FilterSpecification` happily accepts `undefined` as a
value. Centralised into one helper that always returns a real array (`['has',
'name']` alone, or `['all', extra, ['has', 'name']]`) so every one of the
four new label layers goes through the same safe merge rather than
repeating the mistake once per layer.

**Added after `place-labels` in the layers array, not before.** MapLibre
places symbols in layer order, and with the default
`text-allow-overlap: false` a label from an earlier layer claims its space
first and a later, colliding one is hidden — so town names, added first,
stay the highest-priority label on this view the way they are on any
reference map, and a crowded peak, river or road name yields to them
rather than the reverse. No equivalent ordering question existed for any
earlier layer in this file, since `waterway`'s line layer (added for the
river-thread fix above) doesn't participate in symbol collision at all.

Verified with six new test cases (name-only peak text with no `ele`
reference, the per-provider peak schema including the filter-shape
regression check, line-placement for both river and road labels, both
providers' `transportation_name`/`water_name` source-layers, and the
layer-order assertion), 656 tests pass, `tsc`/`eslint`/`prettier` clean.
Confirmed live across three real renders: the Alps near Innsbruck (dense
peak labelling — `▲ Patscherkofel`, `▲ Schneiderspitze`, and dozens more,
with no visual collision against town names), central Munich at street
zoom (road names following their own streets, "Isar" labelled along the
river's curve), and the Ligurian coast at regional zoom ("Mar Ligure / Mer
Ligure" in the water-text blue, `#4d80b3` — `style/water.mss`'s own
`@water-text`, the same real-stylesheet standard the rest of this view's
colours already follow).

## The SiteMark split (above) missed `FeaturePicker.vue` and left two glyphs overflowing their own disc

A batch of six follow-up reports, all against the seven-mark system described
above, fixed together since several turned out to share one root cause.

**`FeaturePicker.vue` never learned about marks at all.** Reported as "the
info panel for the records still holds the old icons" — the pile picker shown
when a tap lands on more than one feature (`describeFeatures`,
`useViewportTiles.ts`) looked up a glyph by `candidate.category` only, the
same lookup `buildSiteIconExpression` used before the mark split. A milestone
or museum pulled out of a pile showed the generic infrastructure cog or
`other` menhir while the map right behind the picker already drew the
specific mark — the one place a reader could compare the two side by side.
`MapFeatureCandidate` (`useSiteQuery.ts`) gained a `subcategory` field,
`describeFeatures` now reads `feature.properties?.subcategory` the same way
it already reads `category`, and `FeaturePicker.vue`'s `iconGlyphFor` tries
`resolveSiteMark` first, falling back to the category lookup exactly as
`buildSiteIconExpression` does on the map. Verified live: a pile containing a
museum record now shows the museum glyph in the picker list, not the menhir.

**`villa` and `museum` overflowed the 10.4-radius disc they're drawn on.**
Reported as "no rounded background" — confirmed by rendering the raw glyph
paths against the disc in isolation (a standalone Playwright+SVG render, not
a guess): Lucide draws `house` and `university` to fill their 24-unit box
edge to edge, and both glyphs' roofline corners poked a visible notch past
the circle, breaking its silhouette. `villa` was redrawn by hand (see next
paragraph) to fit by construction. `museum` kept its Lucide path but gained
`IconGlyph.inset` — the same shrink-and-centre idea `filled`'s `GAME_ICON_*`
constants already apply for a 512-unit silhouette overflowing a 24-unit box,
parameterised instead for a 24-unit outline overflowing its own
(`OUTLINE_INSET_TARGET_SIZE = 20`, `OUTLINE_INSET_OFFSET`/`_SCALE` derived
from it). Canvas (`rasteriseIcon`) divides stroke width by the inset scale to
compensate, the identical compounding `REFERENCE_HALO_WIDTH`'s own docstring
already explains for the filled family; the two SVG consumers
(`Legend.vue`, `FeaturePicker.vue`) use `vector-effect="non-scaling-stroke"`
instead, which keeps a path's stroke at its specified width regardless of
any transform applied to it — no manual division needed there, since the
canvas has no equivalent primitive.

**`villa` and `MILESTONE_ICON_PATH` were hand-redrawn, not re-sourced** —
reported directly that both read as the wrong thing. `house` (Lucide) is a
plain modern dwelling, not a landhouse; `milestone` (Lucide, the glyph this
mark was literally named after) draws a pointed roadside placard — the
_English_ sense the word has drifted to, not a Roman milliarium. Neither
Lucide nor game-icons.net carries a villa-rustica porticus or a cippus
specifically (checked, not assumed, the same verification this file already
holds every borrowed glyph to), so both are now bespoke paths: `villa` draws
a gabled roof over two columns flanking a doorway (a porticus, the
recognisable feature of a villa rustica, against `sanctuary`'s own
temple-front columns with no roof at all); the milestone mark draws a
capsule — straight-sided, semicircular-topped stone pillar — on a plinth
wider than the shaft, with two short strokes for the carved distance
inscription. Both were iterated against the same isolated-render technique
used to catch the overflow bug above before landing on a design that reads
clearly at the actual 46px marker size, not just at preview scale — a first
villa draft (three roof peaks sharing one wall silhouette, meant to read as
a winged villa with corner towers) rendered as an unreadable "crown" of
spikes once the roof triangles weren't visually distinct from the wall
verticals beneath them, caught by rendering it before committing to it
rather than after.

**Road, milestone, mansio and the generic infrastructure cog read as a
brownish smear in dark mode, next to every other mark's plain ink.**
`registerSiteIcons`/`registerSiteMarkIcons` drew every infrastructure-category
glyph and mark in `palette.linear` (`#bfae7e` in dark mode — a warm tan,
intentionally tying a bridge or milestone to the bronze tracings per this
mark system's own original design note) while every non-infrastructure glyph
drew in `palette.ink` (`#e7dfcd` — pale, near-white). Reported directly as
inconsistent and asked to match "the others". Fixed, but not by dropping the
bronze tie everywhere: `SITE_MARK_IS_LINEAR` now names only `bridge` and
`aqueduct` — both filled game-icons silhouettes, where a saturated colour
reads as the material of a solid shape rather than as a stray tint. Every
stroked outline mark (`road`, `milestone`, `mansio`) and the generic
`infrastructure` cog switched to plain `palette.ink`, matching their stroked
siblings. `SITE_MARK_CATEGORY` (infrastructure vs. other) no longer decides
ink colour at all — kept only as the descriptive parent-category fact it
always also was.

**Asked directly: is the generic `infrastructure` cog still reachable after
the mark split?** Queried the dev database directly rather than reasoning
about it: every one of the 7,008 `category = 'infrastructure'` rows carries
one of the five marked subcategories (road/bridge/milestone/aquaduct/mansio)
— none falls through to the cog today. Left wired as
`buildSiteIconExpression`'s fallback regardless: `other`'s menhir already
covers real, non-hypothetical fallback traffic from subcategories with no
mark of their own (rural/building/baths/theater/memorial), and removing the
one glyph that currently has zero traffic would just mean a future unmarked
infrastructure row drawing nothing.

**The control row at the top of the map "jumped" when a marker was tapped —
reported, measured, and found to not actually move at all.** `Overlays`/
`Roman Empire`/`Maps`, the offline-download and geolocate buttons are all
inside one `absolute inset-0` wrapper on `app/pages/index.vue`, a pure
overlay with no layout participation — opening `SiteDetailPanel`,
`TracingDetailPanel` or `FeaturePicker` (each its own `absolute` aside,
`z-30`, up to `md:w-[26rem]` wide on desktop) never resizes that wrapper.
Confirmed with real `boundingBox()` reads before and after a click: every
control's position was pixel-identical — they were never moving, only fully
hidden under the panel's higher stacking context for as long as it stayed
open, on both the right-anchored control row and the lower-right download/
geolocate column. Fixed the same way `isFollowingLimes`'s `md:pl-[23rem]`
already clears space for the frontier panel on the left: a new
`isRecordPanelOpen` computed (any of `isPanelOpen`/`isTracingPanelOpen`/
`isPickerOpen` from `useSiteQuery`) conditionally adds `md:pr-[27rem]` to the
same wrapper, one rem past the panels' own width.

## `.leaf`'s own `position: relative` was fighting `.absolute` on the same element — the real cause of the three top buttons "jumping"

Reported again after the fix above: opening any of `OverlaySwitcher.vue`,
`PeriodSwitcher.vue` or `BasemapSwitcher.vue`'s flyout menus made the buttons
visibly jump sideways — a different bug from the panel-covering one just
above, which really had been fixed; this one was never about a record panel
at all. All three flyouts share the exact same markup, `class="leaf absolute
right-0 top-full z-20 …"` on the panel itself — `.leaf` _and_ `.absolute` on
one element.

`.leaf` lives in `@layer utilities` (moved there earlier for the
background-colour-vs-Preflight fight documented above) and itself declares
`position: relative` — leftover from the long-removed `.leaf-margin`
companion class, positioning a ruled annotation column against it. Nothing
left in the app needs `.leaf` to be a positioning context on its own account
(checked: no element has a child absolutely positioned against a `.leaf`
ancestor), but `.absolute` is _also_ a `@layer utilities` class, so the two
rules setting the same `position` property inside the same layer resolve by
source order, not by which one "sounds" more specific — and confirmed live
with `getComputedStyle`, `.leaf` was winning: the open panel computed to
`position: relative`, not `absolute`.

A `position: relative` flyout is back in normal flow as block content inside
its own `relative ml-auto` trigger wrapper (the wrapper gets `ml-auto` from
`app/pages/index.vue`, merged onto the component's own root `class="relative"`
via Vue's attribute fallthrough) — so the wrapper's flex-item size grows to
fit the entire open panel (measured 256×600px, not the trigger's own
40×32px), and the flex row reflows everything after it: `MapSearchField`,
sized from the leftover space, gets squeezed down to a sliver, and
`PeriodSwitcher`/`BasemapSwitcher` get shoved sideways by however much
`OverlaySwitcher` just grew. All three trigger buttons use the identical
panel markup, so every one of them reproduces the same jump when opened.

Fixed by deleting `position: relative` from `.leaf` outright, not by
reaching for a scoping or specificity trick on the three panels — it was
dead weight (nothing used it) actively causing harm (everything that is both
`.leaf` and `.absolute`, `.sticky` or `.fixed` at once was at the mercy of
this exact same source-order coin flip). Verified with a live
`getBoundingClientRect` dump of the row and its children before and after
opening the menu: the button positions are now bit-for-bit identical
open vs. closed, at both desktop and mobile widths (this was most dramatic at
390px, where the search field collapsed to 48px and the trigger itself
jumped 174px before the fix).

## Site icons draw uniformly in bronze now, map and picker alike — reversing an earlier per-category split

Requested directly: "make the filling of all site icons look like bronze, so
they look all the same," extended explicitly to the picker list
(`FeaturePicker.vue`) as well as the map. This is a deliberate, direct
reversal of the earlier fix two sections up ("road, milestone, mansio and the
generic infrastructure cog read as a brownish smear in dark mode") — that
fix split ink colour by category/mark; this request asks for exactly the
opposite, uniform bronze everywhere, and is recorded as the current, correct
behaviour rather than something to reconcile with the older comment.
`registerSiteIcons` and `registerSiteMarkIcons` both now pass `palette.linear`
unconditionally, `SITE_MARK_IS_LINEAR` (the per-mark split) was deleted
outright rather than left unused, and `Legend.vue`/`FeaturePicker.vue` both
hardcode the bronze Tailwind classes for every category and mark glyph,
filled and outline alike, instead of branching per entry.

## The road mark was redrawn — "a modern highway with lane markings is not a Roman road"

`ROAD_ICON_PATH` (`SiteMarkKind` 'road') was Lucide's own `road` icon: a
receding trapezoid with a dashed centre line — a 20th-century traffic
marking no Roman road ever had. Replaced with a hand-drawn glyph: the same
receding-trapezoid perspective, but with regularly spaced transverse joints
standing in for large fitted paving slabs, the feature actually associated
with an ancient paved road. Verified rendered at both preview scale and the
real 46px marker size before committing to it, the same technique used for
the earlier milestone/villa redraws in the section above.

## Map search ranking

`/api/sites/search`, `/api/places/search` and `/api/atlas/places/search` each
return a `relevance` on one shared scale (`server/utils/search-relevance.ts`):
1 = name starts with the term, 0.9 = a later word does, ≤0.8 = trigram
similarity. `useSiteSearch` merges the three lists through `rankSearchResults`
(`shared/utils/search-ranking.ts`): stable sort on `relevance`, and trigram-only
results are dropped once any name match exists. Before this the client
concatenated the lists, so "vitud" showed the modern town Vite above the ancient
Vitudurum, followed by unrelated near-misses. Modern places still sort by
population within the prefix band (every prefix match scores exactly 1), which
is what keeps London ahead of Londa.
