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

## How the map stays fast

1. `GET /api/tiles/{z}/{x}/{y}.mvt` → validate coordinate → check Valkey → `ST_AsMVT` against a GiST index.
2. **Below zoom 9**: counted clusters, snapped to a grid in _projected_ space (square cells at every latitude). **At 9+**: individual sites. **Tracings from zoom 7**, simplified with a tolerance derived from metres-per-pixel.
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
