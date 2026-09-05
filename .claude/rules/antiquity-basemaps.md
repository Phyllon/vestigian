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
