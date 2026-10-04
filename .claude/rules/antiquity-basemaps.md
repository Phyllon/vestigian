---
paths:
  - 'server/utils/atlas.ts'
  - 'server/utils/limes.ts'
  - 'shared/utils/limes.ts'
  - 'server/api/tiles/antiquity/**'
  - 'server/api/tiles/limes/**'
  - 'server/api/limes/**'
  - 'scripts/import/05-antiquity-atlas.ts'
  - 'scripts/import/06-limes.ts'
  - 'scripts/import/19-ohm-empire-extents.ts'
  - 'server/api/tiles/antiquity-empire/**'
  - 'server/api/atlas/empire-periods.get.ts'
  - 'app/composables/map/useEmpirePeriods.ts'
  - 'scripts/import/13-battles.ts'
  - 'server/utils/battles.ts'
  - 'server/api/tiles/antiquity-battles/**'
  - 'scripts/import/14-ancient-ports.ts'
  - 'server/utils/ports.ts'
  - 'server/api/tiles/antiquity-ports/**'
  - 'scripts/import/15-orbis-routes.ts'
  - 'server/utils/orbis-routes.ts'
  - 'server/api/tiles/antiquity-routes/**'
  - 'scripts/import/16-awmc-minor-features.ts'
  - 'scripts/import/17-awmc-minor-lines.ts'
  - 'server/utils/minor-features.ts'
  - 'server/api/tiles/antiquity-features/**'
  - 'scripts/import/18-chrr-coin-hoards.ts'
  - 'server/utils/coin-hoards.ts'
  - 'server/api/tiles/antiquity-coin-hoards/**'
  - 'app/composables/map/useMinorFeatureOverlay.ts'
  - 'app/composables/map/useCoinHoardOverlay.ts'
  - 'app/composables/map/usePortOverlay.ts'
  - 'app/composables/map/useRouteOverlay.ts'
  - 'app/composables/map/useBattleOverlay.ts'
  - 'app/components/limes/**'
  - 'app/composables/limes/**'
---

## Antiquity basemaps — one borrowed, one built, plus a satellite view

The switcher offers four views in two groups. `Vestigian` is a recolouring of
one modern vector source with modern infrastructure pushed to the background;
`Satellite` is real photography (raster, not vector) from a different source
entirely; the two **antiquity** views replace the vector source outright.
There used to be a fifth: `modern`, a full-opacity recolouring of the same
vector source `Vestigian` already draws, dropped because it was too slight a
difference from `Vestigian` to earn its own entry — `Satellite` replaced it
with a genuinely distinct way of looking at the ground instead. A third
modern view, `terrain`, was deleted earlier still: it was the `vestigian`
palette with one hillshade layer spliced in, and the same elevation source
does better work as `atlas-hillshade` under the Barrington sheet — so the
relief is still on the map and the option was a fourth way of looking at the
same roads. `NUXT_PUBLIC_BASEMAP_TERRAIN_URL` stays; the tiles are still
fetched.

**Antiquity (DARE)** is raster, from `dh.gu.se/tiles/imperium` — Johan Åhlfeldt,
Gothenburg. CC BY-SA 3.0 with attribution and a link, per his terms page. **But**
DARE's own legend credits two inputs as CC BY-NC 3.0 and CC BY-NC-SA, which the
blanket BY-SA cannot cover: the rendered tiles bake in layers DARE itself calls
non-commercial. Acceptable while nothing here is sold; the wrong dependency the
day it is. Mirrored with `pnpm import:basemap dare` — z3–z10 over Europe and the
Mediterranean, **29,593 tiles** at a measured 40 KB mean (~1.2 GB), one request
every 1.2 s. **Tell Åhlfeldt before the full run** (johan.ahlfeldt@lir.gu.se) and
quote that number, exactly as with René Voorburg's photographs; ask about the
NC-credited inputs in the same message. Until
`NUXT_PUBLIC_BASEMAP_ANTIQUITY_DARE_URL` is set the app falls back to his server.

**Satellite** is Sentinel-2 cloudless, from `tiles.maps.eox.at` — EOX IT
Services GmbH, Vienna, built from ESA Copernicus Sentinel-2 open data. There is
no live geocoding-grade satellite source that is both EU-based and genuinely
open-source; this is the closest real match — an open-_data_-derived tile
service, the same category this project already accepts for DARE and the
PMTiles basemap. **The 2025 vintage this app uses is CC BY-NC-SA 4.0** —
EOX's older 2016/2017 vintage is unrestricted CC BY 4.0, but eight to nine
years further from current; the 2025 vintage was chosen anyway, on the same
"acceptable while nothing here is sold" trade-off DARE's own attribution
above already documents, not a coincidence. **EOX's tile path is
`{TileMatrix}/{TileRow}/{TileCol}` — `z/row/col`, not the `z/x/y` every other
raster source in this file uses** — confirmed by fetching the same coordinate
both ways and looking at the actual imagery: `z/x/y` landed on generic
forest, `z/y/x` clearly showed the Danube through Vienna. Both
`SATELLITE_TILES` in `useBasemapStyle.ts` and `TILESETS.satellite` in the
mirror script write `{y}` before `{x}` for exactly this reason; a mirrored
pull-zone URL, once one exists, is a normal `z/x/y` path in this project's
own storage regardless — only the live EOX fallback carries the quirk.
Mirrored with `pnpm import:basemap satellite` — z3–z13 over the same bbox as
DARE (Sentinel-2's own ~10m/pixel resolution rules out going deeper; see
`SATELLITE_MAX_ZOOM`'s docstring), measured at **~1.9M tiles, ~19 GB** from a
32-tile real sample averaging 10.1 KB/tile. **Tell EOX before the full run**
(cloudless@eox.at), same courtesy as Åhlfeldt and Voorburg. Until
`NUXT_PUBLIC_BASEMAP_SATELLITE_URL` is set the app falls back to EOX's server.

Building and testing the satellite mirror surfaced a real, previously-latent
bug in `04-mirror-basemap-tiles.ts`, unrelated to satellite tiles themselves:
**S3 object metadata must be US-ASCII, and DARE's own attribution string
("Johan **Åhlfeldt**") was never encoded** — every `PutObjectCommand` this
script ever issued for DARE failed its SigV4 signature, confirmed directly
against this project's own MinIO ("the request signature we calculated does
not match the signature you provided" — a message that names the credentials,
not the actual cause). The DARE mirror script had, as far as this evidence
shows, never successfully stored a tile. Fixed by `encodeURIComponent`-ing
the `Metadata.attribution` value, the standard escape for non-ASCII S3
metadata, and confirmed live: the identical request that failed before the
fix now succeeds.

**Antiquity (Barrington)** is ours, and the more interesting one. The CAWM tile
server that was going to supply it publishes _physical relief only_ — no roads,
no names, no settlements — so mirroring it would have bought a beautiful empty
map. What makes it an atlas is published separately as open data, so the data is
imported and this project draws the sheet itself:

| Layer                    | Source                                               | Rows   |
| ------------------------ | ---------------------------------------------------- | ------ |
| Ancient coastline        | AWMC `shoreline`                                     | 9,901  |
| Sea and inland water     | AWMC `open_water` (10 of 20 regions), `inland_water` | 13,907 |
| Roads                    | AWMC, from the Barrington Atlas                      | 3,166  |
| Aqueducts, canals, walls | AWMC                                                 | 477    |
| Urban extents            | AWMC                                                 | 95     |
| Regions and peoples      | AWMC `regional_name_linework`                        | 2,618  |
| Places                   | Pleiades                                             | 38,002 |

Places carry a **mark**, not just a name: Pleiades' free-text `featureTypes` are
collapsed once at import into the same nine categories the contributed records
use (`resolvePlaceCategory`), so one key explains the whole map. **They are drawn
as annotation — the same glyphs with no disc behind them and a thinner line.**
Twenty-two thousand borrowed places against sixty-one thousand contributed
records, given identical markers, would make the atlas look like the work; the
legend says so too when an antiquity view is showing. A place Pleiades does not
classify — a river, a cape, a people — gets its name and no mark, because
inventing a symbol would claim a site where the source records a landscape. So
does a place Pleiades declines to locate: `unlocated` and `related` rows carry a
representative point that is a filing convenience, and 8,545 of them are dropped
rather than drawn.

Relief comes from the elevation tiles at `NUXT_PUBLIC_BASEMAP_TERRAIN_URL` — in production a PMTiles mirror on our CDN (`scripts/ops/mirror-terrain.sh`, runbook §15a), with **no relief at all while it is unset** (the public fallback host is Cloudflare and the production CSP refuses it). CAWM's
raster sheet is exactly that and nothing else, and mirroring it would have cost
3.2 GB and thirty thousand requests to Iowa for imagery carrying no information
this map does not already draw. Where the ground genuinely has changed — a
silted harbour, a shifted delta — it is the coastline that records it, and that
comes from AWMC.

`pnpm import:atlas`, which downloads to `.import/atlas/`, replaces each layer
wholesale and bumps the atlas cache generation itself. `ATLAS_SKIP_OPEN_WATER=1`
omits the 240 MB of sea polygons and still gives a usable sheet. ~75 MB in
Postgres.

**AWMC is ODbL 1.0 and Pleiades is CC BY 3.0, which is why every row lives in
its own `antiquity_*` table and is never joined to `sites`.** ODbL's share-alike
attaches to a derivative _database_: folding these into the tables behind
`/api/data/sites.geojson` would arguably pull that feed under ODbL and
contradict the CC BY-SA / CC0 the contributed data carries. Rendered tiles are a
Produced Work and need only the attribution the style carries. Do not merge them.

Four things about these views that are not obvious:

1. **The overlay follows the _sheet_, not the theme** (`resolveSheetTone`).
   Parchment is parchment at midnight, and the night palette — pale ink on a
   dark disc — drawn on it makes every site marker vanish with nothing logged.
   Dark mode dims the surround instead, so the sheet reads as paper under a lamp.
2. **Tile URLs must be absolute.** MapLibre builds requests inside a worker,
   where a root-relative path has no base: `new Request('/api/tiles/…')` throws
   and the source silently loads nothing while the rest of the style renders.
3. **Atlas tile filters compare in 4326**, against the tile envelope transformed
   into it — never `ST_Transform(geom, 3857) && env`, which cannot use the GiST
   index and measured 1.1–2.6 s per tile against 3–60 ms.
4. **The atlas has its own cache generation**, and `getAtlasVersion` reads an
   unset key as 1 — so the first `INCR` by hand is a no-op. The import clears
   the key and the stale tiles itself; do not do it manually.

## Modern place names — a reading aid over DARE and Barrington

Requested directly: an easy-to-reach switch, over both antiquity views, for
today's city and town names — neither sheet has any of its own. DARE is raster
photography of Åhlfeldt's own cartography, nothing more; Barrington's own place
labels (`atlas-places`) are Pleiades' _ancient_ names, which is the opposite of
what a reader gets no bearings from at all otherwise.

**`canShowModernLabels` is the one `canShow*` flag in `useBasemapStyle.ts` that
is not a constant `true`** — the direct precedent is the period scrubber above:
these names are a fact about _today's_ ground, which only makes sense as a
reading aid over a historical sheet, not over `vestigian` (which already draws
them) or `satellite` (photography that already shows modern infrastructure
directly). `OverlaySwitcher.vue`'s `canShow`-gated skip-rather-than-disable convention
does the rest: the toggle simply is not in the list outside DARE/Barrington,
the same as the Tabula Peutingeriana entry disappearing when the server-side
flag is off.

**Drawn as its own overlay, not baked into `buildDareStyle`/`buildAtlasStyle`.**
`useModernLabelsOverlay.ts` adds the exact vector source and symbol layer
`vestigian`/`satellite` already draw (`buildVectorSource`/`buildPlaceLabelsLayer`,
both exported from `useBasemapStyle.ts` for this), the same "overlay on top of
whichever basemap is showing" shape `useBattleOverlay` etc. already use — **but
under its own id** (`modern-labels-overlay`, both source and layer), not
`vestigian`/`satellite`'s own `basemap`/`place-labels`. Reusing their ids would
have raced this overlay's own `attach`/`detach` — driven by a plain `watch()`,
outside the `currentStyle` → `setStyle` pipeline — against MapLibre's diffed
`setStyle` itself the instant a reader switches from DARE straight to
`vestigian` with the toggle still on: the diff wants to _keep_ that id
(`vestigian` defines the same one, just at a different opacity) at the exact
moment `detachModernLabelsOverlay` is trying to remove it. Distinct ids mean
the two mechanisms can never contend for the same MapLibre object.

**Full opacity, not the quiet 0.7 `vestigian`'s own always-on labels use** — a
reader who explicitly switches this on wants to read it, matching the choice
already made for `satellite`'s labels (see `.claude/rules/map-and-tiles.md`'s
city-names section) rather than inventing a third opacity value.

## The limes — a switch on the Barrington sheet

Not a fifth view. **Follow the limes** is a switch inside the antiquity group of
the basemap switcher, shown only when the Barrington sheet is chosen, and
`buildAtlasStyle(source, { limes })` is the same function either way — forking
it would have left two copies of a hundred layer specs to drift. There is a test
asserting the switch-off layer list is byte-for-byte what it was.

**There is no open dataset of "the limes".** There is one of where the empire
ended, which is the same thing: the boundary of AWMC's
`roman_empire_ce_200_extent` polygon, minus a 6 km buffer around the ancient
shoreline already in `antiquity_lines`. Measured, not assumed —
**5,123 km in 11 runs** over Europe and the Mediterranean, ~12,000 km over the
whole empire, against UNESCO's "over 5,000 km". The built works come from the 92
rows of `antiquity_lines.kind = 'wall'` the atlas import already loads.

`shared/utils/limes.ts` is the one editorial input: **names, dates, prose and a
bounding box** for seventeen sectors. Every metre of geometry is AWMC's. The
import reports every run and wall no sector claimed — deliberately including
~2,200 km of southern Egyptian desert edge, which was a provincial boundary and
not a frontier system, and the city and isthmus walls in AWMC's `walls` layer.

`pnpm import:limes`, after `pnpm import:atlas`. One 553 KB download and about a
minute of PostGIS; ~2 MB in Postgres. It rides the **atlas** cache generation
rather than a third counter and clears `limes:v*` alongside `atlas:v*`.

Seven things that are not obvious, five of them found by running it:

1. **`line-dasharray` is not data-driven.** A `match` on the segment's kind is
   the obvious way to draw a wall solid and a river dashed, and MapLibre accepts
   the style without complaint — the property is cross-faded, so the expression
   is ignored and every stretch comes out solid. One layer per kind.
2. **`ST_Union` then `ST_LineMerge` does not give you a course.** A sector's
   stretches cross constantly — Hadrian's Wall is the derived province edge plus
   ten pieces of wall linework running through it — and unioning nodes every
   crossing. The merged result was a four-point line that went 35 km west and
   came back, and every fort on the wall then located to the same point on it.
   Merge each stretch on its own and take the longest.
3. **`ST_LineLocatePoint` clamps.** Everything past either end of the path
   projects onto its first or last vertex, so a dozen forts beyond the western
   terminus opened the roll all reading "at the start". Anything that clamps
   from further out than `TERMINUS_METRES` is past the end of the stretch, not
   on it.
4. **Sector bounds overlap, so claiming must be exclusive.** A stretch is
   clipped into every sector it crosses — one Danube run legitimately spans
   Noricum, Pannonia and Moesia — but where two sectors accepting the same kind
   share ground, the earlier subtracts from the later. 209 km was in the
   database twice before `claimLimesSectors` did this.
5. **`Shape_Area` in AWMC's extent files lies.** Britain's polygon carries
   `Shape_Area: 0.0` in the 200 CE file, so filtering mainland masses on it
   dropped the entire British frontier while the import reported success. The
   filter measures the polygon's own extent instead.
6. **Two source populations, drawn apart.** Contributed fortifications get the
   plan marks with a disc; Pleiades military places get the same marks as
   annotation. Each layer excludes what the other draws, or every tower on the
   wall carries two glyphs stacked on one point.
7. **`sites.subcategory` is why turrets read as turrets.** `CATEGORY_BY_KIND`
   collapses vici's `fort`, `watchtower` and `camp` into one `fortification`
   category; the column keeps the source's own word beside it. Re-running
   `import:convert` fills it through
   `ON CONFLICT … DO UPDATE … WHERE subcategory IS NULL`, the only column a
   re-run may overwrite. 12,804 fortifications split into 6,914 watchtowers,
   5,551 forts, 339 camps.

**Licence:** the sector tables are ODbL, like `antiquity_*`, and are never
joined to `sites`. The one judgement call is `offsetMetres` in
`/api/limes/sectors/:slug` — a position measured against ODbL geometry for
records that are not ODbL. It is computed **on read and never stored**, and
`/api/data/sites.geojson` gains no field from it, so what leaves is a Produced
Work with both attributions attached. See the docstring on that endpoint.

## The period scrubber — 51 steps from OpenHistoricalMap

**The scrubber now moves through a continuous dated series, not three
snapshots.** `19-ohm-empire-extents.ts` imports 52 time slices from
OpenHistoricalMap covering 509 BCE to 476 CE; the AWMC three-date version
described below is what it replaced, kept here because its licence research
still stands and because the reasons the replacement is _not_ strictly better
matter.

**Source and licence, verified live.** OHM is **CC0 1.0** — its `/copyright`
page states the whole database is "dedicated to the public domain under a
Creative Commons CC0 dedication". This is not inherited from OpenStreetMap
and is not ODbL; the difference was checked rather than assumed, because
every other borrowed layer in this atlas _is_ share-alike. The page's one
carve-out is that individual elements may carry `license=*` for CC BY /
CC BY-SA content: of the 87 Roman-state boundary relations, exactly two set
that tag and both say `CC0-1.0`. Nothing imported is encumbered. It is still
credited (`EMPIRE_EXTENT_ATTRIBUTION`) even though CC0 compels nothing — OHM
asks, and a reader judging a frontier line is owed the knowledge that this
one is contributor-drawn.

**What OHM actually holds**, found with an Overpass query against its own
instance (`overpass-api.openhistoricalmap.org`), not from documentation:
`type=boundary`, `admin_level=2`, `border_type=empire` relations, one per
interval, tagged `start_date`/`end_date`, under four names — Res Publica
Romana (20 slices, -509..-27), Imperium Romanum (19, -27..395), Imperium
Romanum Occidentale (12, 395..476) and Imperium Romanum Orientale (36,
395..1453). Many also carry `end_event`, a plain-language note on what closes
the slice ("Trajan conquers Armenia", "Vandals conquer Africa"), which the
scrubber shows under the slider.

**Cutoff: slices beginning before 476**, the deposition of Romulus
Augustulus — the same end-of-antiquity line `13-battles.ts` draws at 500,
moved to the exact event because here there is one. That keeps the Eastern
empire's first slice (395–476, contemporaneous with the West) and drops the
35 Byzantine slices after it, which belong to a different atlas. **52 rows,
51 distinct steps** (two pairs of slices share a start year).

**The honest trade-off, stated because it is a real one.** AWMC's three
extents were drawn by academic cartographers; OHM's 52 are drawn by
volunteers, and some relations openly tag their own boundary lines as still
needing a source. This is an approximation, and the scrubber says so in the
interface (`basemapSwitcher.periodApproximate`) rather than implying survey
precision. The judgement was that 51 dated steps a reader can actually watch
the empire grow through is worth more than three precise ones, **given** that
the interface admits what it is.

**Dates are traditional BCE counts, not astronomical ones** — OHM's `-0509`
is 509 BCE, not 510. This is the opposite of Wikidata's convention (see the
battles section), so it was verified against slices whose dates are not in
dispute — `-0264..-0241` the First Punic War, `-0146` the fall of Carthage,
`-0027` Augustus — rather than assumed. Getting it backwards would have
shifted the entire Republic by a year, silently.

**Geometry is assembled with `osmtogeojson` (MIT), not by hand.** A relation
is member ways, not a polygon: the 106–114 CE slice alone has 1,071 outer
ways and 83,599 coordinates, and ring assembly with islands is the
well-solved problem this project's conventions say to borrow. **Pin the
stable 2.x** — npm's `latest` tag is a 3.0 beta, and the two versions differ
in output shape: 2.x nests OSM tags under `properties.tags`, the beta
flattens them onto `properties`. Reading the wrong shape yields `undefined`
names with no error at all.

**Served by year, not by slice id.** `/api/tiles/antiquity-empire/:year/...`
selects every row whose half-open interval contains that year
(`start_year <= y AND end_year > y`). After 395 that draws the Western and
Eastern empires together without the caller knowing there are two, and the
handful of overlapping refinements OHM carries merge into one fill instead of
fighting. 2.9 million vertices across the 52 slices makes `ST_Simplify`
matter here far more than it did for AWMC's three.

**The steps are fetched, not hardcoded** (`/api/atlas/empire-periods`,
`useEmpirePeriods.ts`). Three dates could live in a client constant; 51
cannot, and they change when OHM's contributors refine a boundary. The
request is made only when a reader opens the switcher _on the sheet that has
a scrubber_ — the same restraint that keeps the extent tiles out of the style
until a period is actually chosen. `end_event` is English-only upstream and
deliberately **not** machine-translated: `translate-locales.ts` bootstraps
interface strings, not historical claims. Era notation _is_ translated
(`periodYearBce`/`periodYearCe`), since `v. Chr.` and `av. J.-C.` are not the
same string.

**`USlider` still moves over an index domain, not the year** — and the
reasoning matters more now than with three dates: the gaps run from one year
(116→117) to 171 (-509→-338), so a value-mapped slider would compress the
entire early Republic into a few pixels.

### What this replaced — AWMC's three dates (superseded, research retained)

`12-antiquity-periods.ts`, `antiquity_period_extents` and
`/api/tiles/antiquity-periods` are **gone**, dropped in the same migration
that added `antiquity_empire_extents`. Keeping both would have meant either
two scrubbers for one idea or a dead code path; the licence research below is
kept because it is still the reason the _limes_ derivation trusts AWMC.

Every antiquity view up to this point was a single fixed snapshot. Research
requested by the user (verify third-party sources live, not from a summary)
found AWMC actually publishes the empire's extent at three separate dates in
its own `Cultural-Data/political_shading/` release — the same repo and the
same ODbL licence `05-antiquity-atlas.ts` already imports from, confirmed by
reading that repo's own `LICENSE.txt` and `README.md` directly, which state
the licence covers **every** GeoJSON in the repo with no folder-level
carve-out.

**Two secondary mirrors of this data — DAI's `iDAI.geoserver` (Germany) and
Project MERCURY (an EU-affiliated dataset index) — both tag it CC-BY-NC
instead of ODbL.** The primary source wins: AWMC's GitHub repo is the one it
actively maintains ("the GeoJSONs continue to provide the most up-to-date
data"), and its own licence statement is unambiguous. The secondary tags are
stale or simply wrong — the same "trust what's live and primary, not a
downstream mirror's tag" lesson already learned once with PD-Mark vs CC0 and
the Heidelberg Anubis red herring in the column-reliefs research.

**`political_shading/` ships six Roman-period files; only three are usable,**
confirmed by downloading and parsing every one of them, not by trusting a
directory listing:

- `roman_empire_bce_60.geojson` (74 Polygon fragments), `roman_empire_ce_117_extent.geojson`
  (112 fragments) and `roman_empire_ce_200_extent.geojson` (112 fragments) —
  used. The 200 CE file is the **same file `06-limes.ts` already fetches
  transiently** to derive the frontier and explicitly discards ("storing them
  would put a fourth copy of the empire's outline in a database that already
  has three") — `12-antiquity-periods.ts` deliberately revisits that decision,
  since a genuine multi-period feature is now a real reason to keep it.
- `roman_empire_ce_200_provinces.geojson` — LineString topology with
  `PROVINCE10`/`PROVINCE_1` fields, but these are opaque ArcInfo
  polygon-adjacency codes (19 distinct numeric pairs found, e.g. `(144,
123)`), not names, and AWMC publishes no lookup table anywhere. Not
  imported — it would draw real internal province subdivisions with no way
  to label a single one of them, the same restraint already applied to
  Commons' un-numbered column-relief plates.
- `roman_empire_provinces post_diocletian.geojson` (96 features) and
  `roman_senatorial_provinces.geojson` (8 features) — every single feature in
  both files carries an identical `Id: 0`, checked across every feature, not
  the first one. Nothing to distinguish one polygon from another. Not
  imported.
- There is no 14 AD, 69 AD or 100 AD file anywhere in AWMC's current
  repository. Those three dates only ever existed in an earlier, unverified
  secondary-source summary (DAI/MERCURY's own listings) — a second real
  instance, alongside the CC-BY-NC tag, of a downstream description being
  simply wrong about the primary source's actual contents.

**Unlike `06-limes.ts`'s frontier derivation, the import applies no
mainland-span filter.** `spansDegrees()`/`MAINLAND_SPAN_DEGREES` exists
specifically to keep tiny archipelago fragments from corrupting
`ST_Boundary` when deriving a frontier _line_ — applying it here would drop
real Roman territory (Sardinia, Sicily, Cyprus) from a map whose whole point
is to draw the empire's actual filled extent. `ST_MakeValid` alone is
enough, matching how the water import already handles ordinary geometry
validity. One row per source polygon fragment, never dissolved into one
shape per period — the same convention `antiquity_lines` already uses.

**The scrubber is a switch on the Barrington sheet, not a fourth view** —
the same shape as "Follow the limes": its own tile endpoint
(`/api/tiles/antiquity-periods/:period/:z/:x/:y`) so a reader who never
touches it requests nothing, but `buildAtlasStyle(source, { limes, period })`
stays one function, extended rather than forked. Shown only while the
Barrington sheet is the active view — the three dates are a property of
_that_ sheet's own data, not a reading that makes sense over DARE or a
modern basemap, so unlike the limes switch (which generalised to work over
any basemap) this one stays scoped. `USlider` (Nuxt UI v3) moves over an
**index domain**, not the year values themselves — 60 BCE to 117 CE is 177
years, 117 to 200 is 83, and a value-mapped slider would draw those gaps as
though they were even.

**Nuxt UI's `<USlider>` forwards `aria-*` props only to `SliderRoot`, never
to `SliderThumb`** — confirmed by reading both components' source in
`reka-ui` and `@nuxt/ui`, not assumed. `SliderThumb` is the element actually
carrying `role="slider"`, so a screen reader names the control from an
element that never received the label at all; `aria-label`/`aria-valuetext`
passed as ordinary props are silently inert. Fixed by setting both
attributes directly on the thumb via a template ref and a `watchEffect`,
kept in sync as the label changes — the smallest fix that doesn't mean
dropping an established component for a hand-rolled `<input type="range">`
over one missing attribute passthrough. A second, unrelated surprise on the
way to that fix: **`useTemplateRef`'s own type only ever models a single
instance, but a `ref` placed on an element inside a `v-for` block is
collected into an array at runtime regardless of how many iterations
actually render it** (this scrubber's markup sits inside the basemap
switcher's `v-for="group in groups"`, guarded by its own `v-if` so it
renders once) — confirmed by logging the raw ref value in a real browser,
which is genuinely `[instance]`, not `instance`, and the type parameter has
to be given as `{ $el?: HTMLElement }[]` for `nuxt typecheck` to agree with
what actually happens at runtime.

Visually confirmed in a real browser, not just asserted by a test: at 60
BCE the fill covers only Italy and a strip of the Republic's early
territory; at 200 CE the fill extends to the whole visible frontier, with
no visible edge inside a typical viewport since the border sits further out
— both exactly what the actual history should look like.

**Researched and not pursued, for the record:**

- **OldMapsOnline / Georeferencer (Klokan Technologies) — blocked by its own
  terms, not by copyright.** Asked for directly as a way to extend the
  scrubber. Its Terms of Use forbid exactly the intended use: content is
  licensed "solely for your personal, non-commercial use", may not be
  redistributed "to any third party", bars "commercial derivative works", and
  — decisively — states that "manipulating or modifying map content, whether
  as vectors, pixels, or underlying metadata, is expressly forbidden".
  Pulling their georeferencing into another map is precisely that. This is a
  contractual restriction layered on top of whatever the scanned sheet's own
  copyright status is, so even a public-domain 1890 atlas page inherits it
  once it is _their_ georeferenced copy. Verified by reading the clause text
  from `web.archive.org`'s snapshot of `/en/terms` — the live site answers a
  plain fetch with a Cloudflare challenge. Separately, it would have been the
  wrong shape anyway: scanned historical sheets, not dated boundary vectors.
- **Deriving extents from Wikipedia/Wikidata conquest dates — good dates, no
  geometry.** A live SPARQL query for `wdt:P31/wdt:P279* wd:Q182547` ("Roman
  province") returns 282 items, most carrying real dates (`P571`/`P576` or
  `P580`/`P582`): Dacia 106–271, Roman Egypt 30 BCE–642, and so on. But
  **zero of the 282 carry `P3896` (geoshape)** — checked, not assumed.
  Wikidata records _when_ a province existed and never _where its border
  ran_. Turning a sentence like "Augustus annexed Egypt in 30 BCE" into a
  frontier polygon means doing the cartographic reconstruction ourselves,
  which is inventing data rather than sourcing it. The idea was superseded
  outright by OHM, which has both the dates and the boundaries. The province
  dates remain a good future source for _labelling_ — "Dacia, Roman province
  106–271 CE" on a polygon already drawn — which fabricates nothing.

- **DARMC** (Harvard, CC BY-NC-SA 4.0) and **siriusbontea/roman-empire**'s
  13-slice reconstructed series were the best leads _before_ AWMC's own
  dated extents were confirmed reachable and ODbL. Redundant once the
  authoritative source was in hand — DARMC's road network duplicates AWMC's
  roads already in `antiquity_lines`, and siriusbontea's series is itself
  partly derived from DARMC's NC-encumbered data.
- **OpenRome** (Nolli 1748 / Lanciani ~3000-year map of the _city_ of Rome,
  Stanford/Dartmouth/Oregon) — a genuinely different feature (urban
  topography at city scale, not imperial political geography), and not
  buildable regardless: no confirmed technical delivery mechanism surfaced
  (no IIIF manifest, no live viewer URL) and no explicit licence, only a page
  saying the data is _planned_ for Stanford's Digital Repository. Same
  treatment as Rome Reborn and the Stanford Forma Urbis Romae project, both
  already rejected for the same reason.
- **Project MERCURY**'s wider 50-dataset catalogue (ceramics, ports, coinage,
  Roman economic modelling) is unrelated to this feature — its only role
  here was as a lead whose one relevant listing carried a stale licence tag.

## Battle sites — an overlay, worldwide, not scoped to Rome

Ancient battles, drawn as a "Show battles" switch — the same overlay
shape `useLimesOverlay` established for the frontier: above whichever
basemap is showing, not a reading of one antiquity sheet, since a
battle's date and location are facts about the world regardless of which
sheet is on screen. `useBattleOverlay.ts` mirrors `useLimesOverlay.ts`
structurally; the one real difference is interaction — see below.

**Source: Wikidata's public SPARQL endpoint, CC0** — already this
project's trusted enrichment backbone. Two candidates were checked and
rejected first, both live, not from memory:

- **Pleiades** has a "battlefield" place-type in its own vocabulary
  (confirmed by fetching `pleiades.stoa.org/vocabularies/place-types`),
  but a query against the full Pleiades CSV `05-antiquity-atlas.ts`
  already imports (all ~42,000 places) found **zero rows using it**.
  Pleiades catalogues continuously-occupied places, not one-off
  engagements — the vocabulary term exists but nobody applies it.
- **OpenStreetMap**'s `historic=battlefield` tag skews overwhelmingly
  modern in sampling (WWII, the Falklands), and a name-filtered Overpass
  query for well-known ancient battles came back empty.

**Cutoff: before year 500**, the conventional end of antiquity (the fall
of the Western Roman Empire, 476 CE, rounded) — chosen so the layer stays
inside the project's own scope rather than sliding into the medieval
period. Query: every item that is an instance of (transitively) `battle`
(Q178561) with a coordinate (P625), dated by a point-in-time (P585) at
year-precision-or-finer. Verified live: **458** such battles, from the
Battle of Megiddo (1457 BCE) onward, worldwide — Kadesh, Marathon,
Gaugamela, Qarqar and the Chinese Spring-and-Autumn battles alongside
Cannae, not a Roman-only set.

**A point-in-time date alone misses every multi-day siege.** The Battle
of Alesia has no P585 at all — only a start time (P580) and an end time
(P582), since it lasted months — found only because it was conspicuously
absent from the first import run, not assumed from the schema. A second
query fetches P580 for the same class and the two result sets are merged
client-side in `13-battles.ts`, P585 preferred where an item has both.
Doing this as one combined SPARQL query (`FILTER NOT EXISTS`) timed out
twice against the public endpoint (60s+) where each query alone answers
in under 5s — the merge happens in the import script instead. The P580
query adds 30 more battles, for **488 total** actually imported. 24 of
the 488 items carry more than one candidate coordinate or date (rival
scholarly hypotheses, e.g. the Assyrian siege of Jerusalem) — the import
takes the first row SPARQL returns and moves on, the same restraint
`isLocatedPrecisely` already applies to Pleiades' own judgment calls.

**Wikidata's ISO dates are astronomical year numbers, not BCE/CE counts**
— year 0 is 1 BCE, year -215 is 216 BCE. A first import run stored Cannae
as "215 BCE" before this was caught by a spot check against a battle with
a well-known date. `13-battles.ts`'s `yearFromDate` converts a BCE
astronomical year (`<= 0`) to this project's own negated-traditional-count
convention (`antiquity_empire_extents`/`antiquity_places`'s `-60` means
"60 BCE", not astronomical year -60) before storing. OpenHistoricalMap,
the period scrubber's source, already writes traditional counts and needs
no such conversion — the two upstreams disagree, and each import states
which convention it is reading.

**Schema**: `antiquity_battles` (`wikidata_id`, `title`, `year`,
`location_precision`, `wikipedia_url`, `geom`) — a new table, not a column
on `antiquity_places`: a battle is an event with a Wikidata id and a
single year, not a Pleiades place with a `min_year`/`max_year` range.
`location_precision` collapses Wikidata's numeric `geoPrecision` (degrees)
into the same `'precise'`/`'rough'` two-value vocabulary
`isLocatedPrecisely` already reads off Pleiades — not a new scale.

**Serving**: `server/utils/battles.ts`'s `buildBattleTileSql`/
`buildBattleCacheKey` copy `limes.ts`'s shape exactly — `WITH bounds AS
(...)`, `geom && b.env_wgs` in 4326, cache key folded into the shared
`vestigian:atlas-version` counter. Its own endpoint
(`/api/tiles/antiquity-battles`), for the same reason the frontier has
one: most readers never switch it on, and it draws over every basemap, so
it could not live inside `/api/tiles/antiquity` even if everyone wanted
it. One point layer, no simplification — at ~490 rows worldwide there is
nothing to thin at any zoom.

**Interaction is deliberately not wired into the site/tracing selection
machinery** (`useSiteQuery`'s `MapFeatureCandidate`, whose `kind` is only
`'site' | 'tracing'`, dispatching to a detail panel that expects a slug).
A battle has neither. `useBattleOverlay.ts` binds its own
`map.on('click', BATTLE_LAYER_ID, ...)` and opens a plain MapLibre
`Popup` — the first use of `Popup` in this codebase, though
`maplibre-gl` was already a dependency — with the title, year and a
"View on Wikipedia ↗" link. `Popup.setHTML` renders raw markup, unlike
every Vue template in this app, so `useBattleOverlay.ts`'s own
`escapeHtmlForPopup` runs on every value before it reaches the popup,
including the Wikipedia URL going into an `href`.

**Mark**: `BATTLE_ICON_PATH` (`useSiteIcons.ts`) is Lucide's `swords` path,
copied verbatim rather than hand-drawn — see the "Marker glyphs are Lucide
paths" section of `.claude/rules/map-and-tiles.md` for the full reasoning
and licence check; that section supersedes this one having once said no
icon-font glyph ever appears on the map. Always drawn as the
reference/pencil variant: every row is borrowed from Wikidata, never a
contribution, the same reasoning `registerLimesIcons`/`registerAtlasIcons`
already give.

## Ancient ports — an overlay, from "Project Mercury"'s catalogue

Following up on "Project Mercury" (projectmercury.eu) — a Roman
computational-modelling project, dormant since 2022, whose main asset
turned out to be a curated link directory of ~45 third-party datasets, not
data of its own. Its listing for the Catalogue of Ancient Ports pointed at
a real, licensed, mirrorable source; two other candidates checked from the
same catalogue — OxREP's stone quarries and mines databases — did not (see
"Researched and rejected" below).

**Source, verified live, not from memory**: `ancientportsantiques.com`,
Arthur de Graauw's Catalogue of Ancient Ports, CC BY 4.0 — the page footer
states this and links the real Creative Commons legal text. The actual
workbook, not just the page, was downloaded and inspected before
`scripts/import/14-ancient-ports.ts` was written:
`.../wp-content/uploads/Documents/GE/AncientPorts.xlsx`, sheet `PLACES`,
6,007 rows, all carrying coordinates. The workbook's own Read me sheet
adds a second citation that travels with the CC BY credit: the same data
is also deposited as the DARMC Scholarly Data Series (Harvard).

**Not year-filtered**, unlike battles: the catalogue spans roughly 8,000
years, Iceland to Sri Lanka, and its `FOUNDATION` column mixes single
years, BCE ranges (`"-10000 to -5000"`) and blanks too inconsistently to
filter reliably — imported as free text, in `foundation`, never parsed
into a number. `title` reads `NAME || NAME_MOD`: the source's `NAME_MOD`
column does double duty as a modern place name when an ancient name
exists, or as the only descriptive text there is when it doesn't (e.g.
"Alta, BA rock carvings showing many ships" for a Bronze Age Norwegian
site) — `title`/`modernName` are both `text`, not `varchar`, since some of
these descriptions run past 400 characters. Roughly 30 more flag columns
(period flags, feature-type codes on the workbook's own "Key to codes"
sheet) are real data, deliberately not imported in this pass — reproducible
from the same workbook later, not silently dropped from anywhere that
isn't.

**Schema**: `antiquity_ports` (`source_row_id`, `title`, `modern_name`,
`country`, `foundation`, `pleiades_url`, `wikipedia_url`, `geom`) —
`source_row_id` is the workbook's own `NB` column, kept as text since it
is sometimes fractional (Excel's own sub-numbering, e.g. "1.1").

**Serving**: `server/utils/ports.ts`'s `buildPortTileSql`/
`buildPortCacheKey` copy `battles.ts`'s shape exactly. Its own endpoint
(`/api/tiles/antiquity-ports`), same reasoning as battles. One point
layer, no simplification — at ~6,000 rows worldwide there is nothing to
thin at any zoom.

**Interaction**: not wired into the site/tracing selection machinery, same
reasoning as battles — a plain MapLibre `Popup` (`usePortOverlay.ts`)
showing title, modern name, country, foundation text, and Pleiades/
Wikipedia links when the row carries them, reusing
`useBattleOverlay.ts`'s exported `escapeHtmlForPopup`.

**Mark**: `PORT_ICON_PATH` is Lucide's `anchor` path (see
`.claude/rules/map-and-tiles.md`), reference/pencil variant — every row is
borrowed, never a contribution.

## ORBIS routes — the Roman transport network, another overlay

**Source, and a real licence discrepancy resolved.** ORBIS v2
(Meeks/Scheidel/Weiland/Arcenas, Stanford, 2014) is mirrored on GitHub
(`github.com/emeeks/orbis_v2`), which genuinely carries an MIT `LICENSE`
file — fetched and read, copyright Elijah Meeks 2013. That covers Meeks's
D3.js viewer application, not the network data the repo also happens to
hold. The data's own licence comes from its authoritative deposit, the
Stanford Digital Repository (`purl.stanford.edu/mn425tz9757`, "ORBIS (v2)
Network Edge and Node Tables"): CC BY 3.0, stated verbatim on that page.
`orbis.stanford.edu` itself states no data licence at all — its only
rights line covers AWMC's own basemap tiles (CC BY-NC 3.0), which this
import does not touch.

**The network was downloaded and inspected before import, not assumed**:
`base_routes.geojson` holds 1,215 edges — 1,206 `LineString`, 9
`MultiLineString` (each component becomes its own row: 1,328 rows total,
`scripts/import/15-orbis-routes.ts`'s `parseRoutes`). `t` is one of six
route kinds (`road` 627, `coastal` 411, `overseas` 69, `upstream` 54,
`downstream` 49, `ferry` 5); `sid`/`tid` node ids are resolved against
`sites_extended.csv` (751 named sites) for popup labels. `e`/`s` are
undocumented cost or duration figures with no verified meaning —
deliberately not imported. A sibling file, `new_routes.geojson`, covers
nearly the same edges with a seasonal `m` field replacing `upstream`;
importing both would double-draw the same connections, so only
`base_routes.geojson` is used.

**Schema**: `antiquity_routes` (`source_node_id`, `target_node_id`,
`source_title`, `target_title`, `route_type` — a `pgEnum`, the same
pattern `limesSegmentKindEnum`/`antiquityLineKindEnum` already use for a
small closed vocabulary — `geom`). `source_title`/`target_title` are left
null when a node id isn't found in `sites_extended.csv`, rather than
dropping the route.

**Serving**: `server/utils/orbis-routes.ts`'s `buildRouteTileSql`/
`buildRouteCacheKey`, same shape again. One line layer, no simplification
— at ~1,300 rows worldwide there is nothing to thin. Drawn in a single hue
(`ATLAS_MARK_INK`, the same reference tone as every other borrowed mark),
never a second colour key: the six route kinds are told apart by dash
pattern (`buildRouteLayer`'s `line-dasharray` match expression) instead,
keeping to the design brief's "one hue for linear features" rule already
applied to tracings and the limes.

**Interaction**: not wired into the site/tracing selection machinery, same
reasoning as battles and ports — a plain `Popup` (`useRouteOverlay.ts`)
showing the translated route kind and, when both ends are known, "Source
→ Target". Never the raw `e`/`s` figures.

## AWMC's minor antiquities — six point kinds from one shapefile release

`16-awmc-minor-features.ts` (`pnpm import:awmc-features`) imports **525
points** from AWMC's shapefile release, the same repo and the same ODbL 1.0
licence as everything else AWMC-sourced here: **368 bridges, 95 mines and
quarries, 15 dams, 11 cemeteries, 10 forts, 26 tumuli**. One table,
`antiquity_features`, keyed by an `antiquity_feature_kind` enum, rather than
six tables — they share a shape (a point, a name, a source citation) and are
drawn by one symbol layer with a `match` expression on `kind`.

**Field names in a DBF are truncated to 10 characters by the format itself**,
which is not corruption. The bridge layer's `Archaic`/`Classical`/`Hell_Rome`/
`Roman`/`Late` columns turned out to be genuine 0/1 period booleans — checked
by reading actual record _values_, not by inferring from the column names,
and collapsed at import into the `periods` display string.

**Two layers in that release are lines, not points — caught only by running
the import.** `causeways` and `dikes_levees` sound like point features and sit
beside the point layers, but their `.shp` geometry type is LineString /
MultiLineString. The first run reported `causeway: 0` and `dike_levee: 0`
against non-zero DBF record counts, which is what exposed it; the fix was to
read `feature.geometry.type` through the real `shapefile` library rather than
trust the DBF alone. They are now `antiquity_line_kind` values imported by
`17-awmc-minor-lines.ts` instead — **1 causeway, 6 dikes/levees** — and the
schema comment on that enum says so, because the next person will make the
same assumption.

**Centuriation** (Roman field-division grids) comes from the same script:
**2,824 lines** into `antiquity_lines` and **221 polygons** into
`antiquity_areas`. The polygons are what exposed a real pre-existing bug —
`atlas-urban` had **no `kind` filter at all** and was drawing every row in the
`areas` source-layer with city fill styling, so the new centuriation blocks
would have rendered as mislabelled cities. Fixed by adding
`filter: ['==', ['get', 'kind'], 'urban']` before the new
`atlas-centuriation-blocks`/`atlas-centuriation-lines` layers went in.

**Icon reuse over a redundant glyph**: `minorFeatureIconId('fort')` returns
the existing `atlasIconId('fortification')` rather than a seventh new mark.
Both mean "a referenced fortification, not a contribution", so
`registerMinorFeatureIcons` deliberately skips `fort`.

## CHRR coin hoards — 620 findspots, and a licence discrepancy resolved

`18-chrr-coin-hoards.ts` (`pnpm import:chrr-coin-hoards`) imports **620**
Roman Republican coin-hoard findspots from `numismatics.org/chrr`'s
`findspots.geojson`, into `antiquity_coin_hoards` (`name`, `hoard_count`,
`geonames_url`, `geom`).

**CHRR states two different licences.** Its human-readable pages and its
machine-readable VoID description disagree — ODbL in one place, CC BY-NC-SA
in another. The stricter, machine-readable statement was treated as
authoritative, and the layer is isolated accordingly: its own table, no
foreign key to `sites`/`tracings`, its own tile endpoint, out of
`/api/data/sites.geojson`. That is the same isolation the ODbL data already
gets, for the same reason — see the note at the top of
`server/database/schema/atlas.ts`.

**CHRE (Coin Hoards of the Roman Empire, Oxford) is not imported, and the
reason is an outage, not the licence.** Its CC BY-NC-SA 4.0 terms would be
workable under exactly the isolation above. But its bulk export — the same
`findspots.geojson` shape that made CHRR trivial — returns **HTTP 500**, as
does its `apis/` documentation page, while the site's home page returns 200.
Verified live. Scraping individual record pages instead was rejected as
disproportionate for a layer this size. Worth re-checking if the export ever
comes back.

## Single coin finds — the link-out panel was removed; the licensing research stays

The site panel used to carry a "Coin finds" section (`SiteCoinFindDatabases.vue`,
backed by `COIN_FIND_DATABASES` in `shared/utils/coin-find-databases.ts`)
linking out to the national or regional finds database covering the site's
`country_code` — AFE-RGK and AFE4HD (DE), AFE-PL, AFE-HU, PAS (GB), SICF
(CH/LI), PAN (NL), DIME (DK). No coin, findspot or coordinate was ever
stored; it was outbound links only. **Removed entirely (2026-09-30, on
request)** — a row of external links to databases covering a site's country
rather than the site itself added no real benefit, since none of them are
scoped tighter than "somewhere in this country" for a reader already looking
at one exact site. `SiteCoinFindDatabases.vue` and
`shared/utils/coin-find-databases.ts` are both deleted, along with the
`siteCoinFinds.*` i18n keys in all six locales.

**The per-source licence research done for that panel is kept here, not
deleted with it — it's the answer to "can any of this ever be mirrored", a
question separate from whether the link-out panel was worth keeping.** Every
link was fetched and its page title checked (2026-09-14), except PAS, which
answers scripts only with a Cloudflare challenge (still 403 on 2026-10-04, with a browser
User-Agent too; its terms page was read from a Wayback copy — CC BY 3.0, see the runbook's
"Still open") None of the eight passed a
mirrorable-licence check at the time:

- **SICF's "Coins online" page embeds its map data** — 382 single-find
  `L.circleMarker`s with coordinates and a popup (canton, municipality,
  location, address, excavation number) in the HTML. Scraping it would
  work mechanically. It carries no licence beyond "© Swiss Inventory of
  Coin Finds", the "Open Data" pages its own navigation links to 404, and
  the popups carry no period, so the points are not even scoped to
  antiquity. Its Zenodo community (19 records) is annual reports and one
  catalogue PDF, all CC BY 4.0, none a dataset.
- **AFE place pages carry `Breitengrad`/`Längengrad` and a CSV export**, and
  AFE describes itself as five-star Linked Open Data — but no page states a
  licence, and the Impressum defaults everything to copyright. The sitemap
  lists 20 coin, 6 findspot and 3 place pages of 1,000 entries each.
- **Also checked, not used (2026-09-14):** Nomisma.org's SPARQL endpoint returned 400 for
  `SELECT ?s WHERE { ?s rdf:type ?o } LIMIT 1` in every output format, and
  OCRE/CRRO's `findspots.geojson` an empty FeatureCollection. **Re-checked 2026-10-04: the
  endpoint answers** (`https://nomisma.org/query`, `Accept: application/sparql-results+json`,
  a query naming the `nmo:`/`geo:`/`skos:` prefixes) and the mints are now imported —
  `.claude/rules/reference-overlays.md`. The coin _findspot_ aggregator (OCRE/CRRO
  `findspots.geojson`) was not re-checked. CoinSampo (Finland) is
  verifiably CC BY 4.0 over SPARQL, but holds 5 Roman-period coins in 18,342.
  MEDEA's `vondsten.be` fails the TLS handshake from here. FMRD (300,000
  German finds) is print-only.

**Asking AFE (afe@dainst.de) and PAS for an explicit licence to mirror their
data is still worth doing at some point, independent of the link-out panel
being gone** — tracked under "Still open" in
`documents/runbook_prod.deployment.md` rather than left only in this file, so
it surfaces outside a session that happens to be touching antiquity basemaps.
If either source ever grants one, that becomes a real import on the CHRR
model (own table, own tile endpoint, isolated from `sites`), with one
constraint that is not negotiable: **never show a findspot more precisely
than the source does publicly** (PAS: parish), and import no finder names.

## Researched and rejected

**OxREP's stone quarries (792 records) and mines (551 records) databases**
have no verifiable licence. Both state only a citation requirement; the
one page that might carry OxREP's site-wide terms
(`oxrep.web.ox.ac.uk/copyright`) returns HTTP 403, gated behind an Oxford
SSO login. No Zenodo/Figshare/ORA deposit was found for either dataset
(OxREP's _Cities_ database does carry a Bodleian DOI — quarries and mines
don't). Quarries' coordinates aren't even in the public HTML table, only
"included in full in the PDF version," and explicitly only "accurate to
within several kilometres." Not pursued as a mirror; the honest next step
is a human one — someone emailing OxREP to ask for terms — not a
workaround in code.

**AWMC's bridges (368 points) and centuriation (2,824 lines) layers**
exist and are ODbL-1.0 (same licence family this atlas already imports
aqueducts/canals/walls/roads/urban_areas under from AWMC's GitHub repo,
`scripts/import/05-antiquity-atlas.ts`) — but they ship only inside AWMC's
"Cultural Shapefiles Apr 2024.zip", not in the GeoJSON files that import
already fetches. Not yet built; a genuine follow-on, not blocked by
licence.

**Coin Hoards of the Roman Republic (CHRR)**, numismatics.org, ODbL —
findspots with coordinates, map-relevant, not yet built. **Coin Hoards of
the Roman Empire (CHRE)** is CC BY-NC-SA 4.0 — the NC this project's own
conventions explicitly permit, but the SA (share-alike) is a real
obligation weighed against nothing else in this codebase and was not
pursued for that reason. **OCRE**/**CRRO** are coin _types_, not
findspots — no coordinates, so neither is a map layer regardless of their
licence (both ODbL).
