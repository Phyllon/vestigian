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

## Reference marks over raster basemaps get a halo — DARE and satellite only

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
`labelHalo` already applies to map labels. Re-registration already happens
for free: `attachOverlayIcons`'s `hasImage` idempotency check is keyed to the
image registry, which `setStyle` wipes on every basemap switch — DARE ⇄
satellite ⇄ anything else always re-registers with the current `haloOnRaster`
value, the same mechanism `sheetTone` already relies on.

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
