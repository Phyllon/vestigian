---
paths:
  - 'app/components/map/**'
  - 'app/composables/map/**'
  - 'server/api/tiles/**'
  - 'server/utils/mvt.ts'
  - 'server/utils/basemap-pmtiles.ts'
  - 'service-worker/**'
  - 'app/pages/offline.vue'
---

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
