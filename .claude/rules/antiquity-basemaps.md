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
  - 'scripts/import/12-antiquity-periods.ts'
  - 'server/api/tiles/antiquity-periods/**'
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

Relief comes from the elevation tiles at `NUXT_PUBLIC_BASEMAP_TERRAIN_URL`. CAWM's
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

## The period scrubber — a switch, not six switches

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
