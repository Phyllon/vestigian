---
paths:
  - 'shared/utils/sightline.ts'
  - 'shared/utils/elevation-profile.ts'
  - 'shared/types/sightline.ts'
  - 'server/utils/sightlines.ts'
  - 'server/utils/elevation-profile.ts'
  - 'server/utils/terrain.ts'
  - 'shared/utils/seen-grid.ts'
  - 'shared/utils/sightline-overlay.ts'
  - 'shared/utils/sector-watch.ts'
  - 'shared/utils/tower-spacing.ts'
  - 'server/api/sites/[id]/sightlines.get.ts'
  - 'server/api/sites/[id]/sightlines/**'
  - 'server/api/tracings/[id]/profile.get.ts'
  - 'server/api/limes/sectors/[slug]/sightlines*'
  - 'scripts/sightlines/**'
  - 'app/components/terrain/**'
  - 'app/composables/terrain/**'
  - 'app/composables/map/useSightlineOverlay.ts'
  - 'app/composables/map/useSectorWatchOverlay.ts'
  - 'e2e/sightlines.spec.ts'
---

## What a frontier tower could see, and the relief along a line

The narrative, with the side knowledge (pixel size by latitude, elevation accuracy, where each height
figure was taken from, results, limits): `documents/line-of-sight-and-relief.md`. This file is the
maintainer's rules.

Two calculations over the terrain tiles the hillshade and "About this spot" already read, shown in
the record panel and on the reading page. **Both are calculations from a model, not records**, and
the interface says so before it says anything else (a "Calculated" tag; "How this is worked out").

| Surface                                           | Answers                                                                                                                                                          | Where it appears                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/sites/:id/sightlines`                   | the view from a limes watchtower's guard platform at three heights — unbroken, and everything seen — the reverse (where it is seen from), sight to nearby towers | `TerrainTowerSightlines` in the site panel and page       |
| `GET /api/sites/:id/sightlines/ray?compass=`      | the ground along one of eight compass lines against the sentry's eyes: what hides what, and where ground returns                                                 | `TerrainRaySection`, under a chosen direction             |
| `GET /api/limes/sectors/:slug/sightlines`         | a sector's towers together: the chain, spacing against reach, the overlooked line, the breaks and blind stretches (**computed by a script**)                     | `TerrainSectorWatch` in the limes panel and on `/limes/…` |
| `GET /api/limes/sectors/:slug/sightlines.geojson` | the ground, the blind stretches and the links, for the map                                                                                                       | the sector switch in `TerrainSectorWatch`                 |
| `GET /api/tracings/:id/profile`                   | elevation against distance along a line, climb, fall, average and steepest slope                                                                                 | `TerrainTracingProfile` in the tracing panel and page     |

Geometry is **pure and in `shared/`** (`sightline.ts`, `elevation-profile.ts`, tested with synthetic
terrain); `server/utils/terrain.ts` turns tiles into an `elevationAt(lon, lat)` sampler; the two
`server/utils/` modules read records and assemble. Nothing here touches a user: no storage, no
cookie, no new third party — `privacy.cookiesBody` and `gdpr-legal.md` are unchanged.

### Which sites are towers

`sites.subcategory = 'watchtower'` **and** within `TOWER_FRONTIER_REACH_METRES` (1,500 m) of a
`limes_sectors.geom`. The vici import files 6,914 sites as `watchtower`; **5,720 of them are
Sardinian nuraghi** (period −3300), so the subcategory alone would calculate a Roman guard platform
for a Bronze Age one. Measured on the dev database (12 Oct 2026): **447 towers** on a sector —
Upper German Limes 296, Raetian 86, Hadrian's Wall 27, Danube (Noricum/Pannonia) 13, Dacian 11,
Transalutanus 6, Tripolitanus 4, Claustra Alpium 4, Lower German 2, Antonine 1. The endpoint
answers `null` for everything else — Nitro sends it as **204 No Content**, which `$fetch` reads as
`undefined`, so each composable maps it back to `null` — cached a day; the panel only asks when
`SiteDetail.subcategory === 'watchtower'` (added for this), so most opened records make no request.

**Not included, deliberately:** forts and fortlets as targets (a tower's relay ends at a fort, and
no sourced height exists for a gate tower or rampart walk), Pleiades "tower-*" reference places
(they have no record panel; a calculation hung on a popup is a separate decision), and a tower's
`Wp` sequence — neighbours are the six nearest `watchtower` records within 5 km, not "the next one
along the sector", because the roll's `offsetMetres` is computed on read from ODbL geometry and
is not stored.

### The height model — an estimate, and the only honest one

No tower stands to its original height. `TOWER_HEIGHT_MODEL` (`shared/utils/sightline.ts`) is a
convergence of what was readable on **12 Oct 2026**, not a measurement of anything excavated:

| Source                                                                  | What it says                                                                                                                                 | How far to trust it                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| limesseiten.de `/LIMES/TUERME.HTML`                                     | "usually about 10 m"; no tower fully preserved, form a guess from Trajan's Column                                                            | uncited, but candid about it                                    |
| gunzenhausen.info `/roemer/wachtuerme/`                                 | "about 10 to 12 m"; ground floor storeroom, first floor living, second upper floor the guard room; base ca. 5 m square                       | uncited                                                         |
| de.wikipedia `Limeswachturm Wp 3/26` (Idstein-Dasbach replica, 2001–02) | about 13 m overall, three storeys, **guard gallery at 8.5 m**; built under the Saalburg museum's supervision                                 | the 8.5 m is footnoted "private measurements"; one replica      |
| theromangaskproject.org `?p=323` (Woolliscroft)                         | the intervisibility analysis uses each tower's "likely full original height"; tests "even from a 10 m tower"                                 | the one place a height is used as an argument; figure not given |
| English Heritage (Denton Hall, Banks East turrets)                      | two or three storeys, "impossible to be certain"; an open parapet or a pitched roof; ~6 m **square** (a footprint, not a height)             | explicit that the upper structure is unknown                    |
| museumhogewoerd.nl (Leidsche Rijn timber tower)                         | reconstruction from the 2002 excavation "supplemented with information from Trajan's Column"; the corner posts survived "up to a metre high" | gives no height                                                 |

Taller claims exist (a 16 m figure for the Hillscheid stone tower; the page is a heritage-site
summary) and are left outside the range because nothing cited stands behind them. **Not found:**
the heights drawn on Trajan's Column (no source gave them), and a sourced turret height for
Hadrian's Wall (a search summary attributed "about 10 m" to an English Heritage school resource; the
page was not opened, so it is not relied on).

The model: **a tower about 10 m high, the guard platform three-quarters of the way up (6 / 7.5 /
8.5 m — the Idstein gallery is the top of the range), a sentry's eyes 1.6 m above it** → eye height
7.6 / 9.1 / 10.1 m. Target: a standing person, 1.7 m. All three are drawn (solid middle, dashed
lower and higher), and every number states its range, because the height is the one thing nobody
measured. **Change a number and bump `SIGHTLINE_MODEL_VERSION`**, or the cache serves the old
answer for a week.

### The calculation

`castSightlines`: 720 rays (0.5°), 15 m steps, out to 10 km (`SIGHTLINE_RADIUS_METRES` — a limit of
the model, not of the eye), 480,000 samples, all three heights sharing one walk. Along each ray the
steepest rise of the ground so far is kept; a point is seen when its top (ground + 1.7 m) clears
it. **Earth curvature with refraction** (`(1−0.13)·d²/2R`, 6.8 m at 10 km) is taken off the
terrain, not added to the eye; at ten kilometres it is the size of the tower.

- **"Unbroken"** is the distance to the first point not seen, and draws as one shape round the tower
  (the polygon on the map, the polar diagram, the eight-sector list). Ground that comes back into
  view beyond a rise is not in it but is counted in "seen at all" and "farthest ground seen".
- **A ray that runs off the data stops there** (`terrainCoverage` < 1 says so in the panel); nothing
  is claimed about ground that was not read.
- **Tower to tower** (`traceSightLine`): the straight line eye to eye against the terrain with the
  earth's bulge `d(D−d)/2R` added, at each of the three heights. The state shown is "in sight at
  every height", "in sight unless the tower stood at the lower estimate", "in sight only at the
  higher estimate" or "hidden by the ground", with the clearance (or how high the ground stands
  above the line, and where). It is symmetric (tested).
- **Rays are narrow, so the shape can be spiky** — a corridor along a ridge becomes a thin spoke.
  That is the calculation, not a drawing fault; it is not smoothed because smoothing would claim
  open ground the rays did not find.

### What the terrain is — read, not assumed

Mapterhorn's tiles (the hillshade source) are **mostly national lidar bare-earth models**, not the
Copernicus surface model `map-and-tiles.md` once implied. `download.mapterhorn.com/attribution.json`
(151 sources, read 12 Oct 2026) lists a terrain model — `DGM`, `DTM`, `MNT`, `MDT`, `DMR`, AHN — for
every German Land, Austria (1 m ALS-DGM and Land models), Slovakia, Czechia, Slovenia, Switzerland,
the Netherlands (AHN5, 5 m, filled), England/Scotland/Wales (1 m), Romania (0.5 m), France,
Spain, Poland, and more. Where there is none the tile falls back to **Copernicus GLO-30, a surface
model in which woodland and buildings are ground**: **Hungary, Serbia, Bulgaria, Croatia, Turkey,
Syria and Jordan** among the limes countries.

"Supposed there are no trees" is therefore satisfied by the data in Germany, Austria, Slovakia,
Britain, the Netherlands and Romania, and **not** along the Hungarian, Serbian and Bulgarian
Danube. `BARE_EARTH_COUNTRY_CODES` is that list, applied by the tower's `country_code`
(`isBareEarthLikely`), and the panel prints a caution when it is false. It is a judgement from the
country, not from the tile: **the source of an individual pixel is not recorded in the tile**, and
coverage inside a country can be partial. A roughness check on a z12 tile over the Taunus
(forested ridge) read a mean absolute Laplacian of 0.78 m at ~12 m pixels — as smooth as a
non-forest tile, which a canopy surface would not be — consistent with a bare-earth model, **not
proof**.

Resolution: a z12 tile is 512 px, ~19 m/px at the equator and **~12 m at 50°N**. Fine for a ridge or
a valley, not for a bank or a ditch; the model cannot see a 2 m obstacle. Elevation uses the tile
mirror (`terrain-z12-*.pmtiles`, 25°W–80°E, 12–66°N) or Mapterhorn's own tiles in development.
`loadTerrainField` decodes every tile it needs once (a 48-tile in-memory LRU, 1 MiB each) and
bilinear-reads across seams; a long line asks only for the tiles its sample points touch and drops
to a coarser zoom past `TERRAIN_FIELD_MAX_TILES` (120).

### The profile along a line

`samplePolyline` walks `ST_LineMerge(geom)` at ≥25 m, at most 600 samples; parts are joined end to
end (`breaks` marks where a further part begins and the chart does not draw across it).
**Ascent and descent ignore wobbles under 3 m** (`ASCENT_NOISE_FLOOR_METRES`), or a flat road read
at 30 m spacing becomes a hill. The steepest stretch is measured over **at least 150 m or one
sample spacing, whichever is longer** (`gradientWindowMetres` is returned and printed): a 242 km
aqueduct sampled every 405 m cannot name a 150 m gradient.

Read for what it is: **the ground a hand-traced line crosses**, not the course of a channel. An
aqueduct follows a contour at a fraction of a per cent while the terrain it crosses varies by tens
of metres; the line's net fall (Aqueduct Istanbul: 291 m → 61 m over 242 km, −0.09 %) is the
meaningful figure and the climb and descent totals on a long line are not. The panel says the
heights are a terrain model of the ground today.

### What a rim looks like — Turm 15-25b, and why "unbroken" is not "seen"

The first version of the tower panel reported only the unbroken view, and for Turm 15-25b
(Raetian Limes, 48.907 N 11.600 E, ground 463 m) that read as a tower that was nearly blind:
**0.5 km² open, the longest run 1.3 km**, and every compass sector closing at 140–390 m. The same
calculation, counted properly, sees **28.1 km² (9 % of the ground within 10 km), out to 10 km to
the east**. It stands on the shoulder of a rim; the near ground hides what falls away behind it and
the far side of the valley comes back into view. Both are true, and a tower's panel now says both.

Along the line due north, from the numbers of the ground (25 m steps, Mapterhorn z12, DTM):

| Distance | Ground | Against the foot | Against the eyes (472.3 m) | Seen                                                            |
| -------- | -----: | ---------------: | -------------------------: | --------------------------------------------------------------- |
| 60 m     |  467.5 |           +4.3 m |                     −4.8 m | yes                                                             |
| 125 m    |  469.7 |           +6.7 m |                     −2.4 m | yes — the crest                                                 |
| 300 m    |  458.6 |           −4.7 m |                    −13.8 m | no                                                              |
| 720 m    |  401.0 |          −62.2 m |                    −71.3 m | no — the Schambach valley floor                                 |
| 1.7 km   |  494 m |          +30.8 m |                    +21.7 m | yes — the far side, which then hides everything beyond to 10 km |

A rise of 6.7 m, 2.4 m _below_ the sentry's eyes, is enough: ground that drops away behind it falls
under the line of sight over its top. The long shadow is cast by the ridge across the valley
(1.7 km, 31 m above the tower), which hides the remaining 8.3 km of the line. The tower is not blind —
**its six neighbours are all in sight at every height**; it is sited for the chain, not for the
outlook (an interpretation, and a hedged one).

**Dead ground** (_toter Raum_, a term the military sources use) is the hidden stretch short of the
farthest ground seen. `describeRay` reports the _first_ obstruction (`firstBlock`) and the _longest_
hidden stretch with the crest that casts it and where ground returns (`deadGround`): a 3 m hummock
100 m out and a valley behind a rim are different answers to "what shrinks the view", and the second
is the one a reader asks about (`sightline.test.ts` pins the distinction).

### The polar diagram, and the same figures on the map

`TerrainSightRose` draws the view as a polar diagram with the figures written on it; the same shapes
and the same numbers are drawn on the map (`buildSightlineMapGeometry`, tested as figures).

- **The radius is a square-root scale of distance, fixed at ten kilometres for every tower.** On a
  linear scale a tower on a wooded ridge is a speck in a target; the square root gives the first
  kilometre a third of the radius and still reaches ten, and being the same for every tower it makes
  two diagrams comparable. The rings are 500 m, 1, 2, 5, 10 km, and the caption says the scale is
  not linear. **The map is to true scale**; the diagram is a diagram.
- **Wedges are ground seen at all** — the polar grid, 1° × 100 m, 4.5 KB as base64 (`SeenGrid`,
  `shared/utils/seen-grid.ts`): a cell is seen when at least half the 15 m samples in it were. The
  solid outline is the unbroken view at the middle height, the dashed ones the lower and higher
  estimate; dots are nearby towers (hollow: hidden).
- **Numbers.** At each of the eight compass points: how far the view is open, and beneath it the
  farthest ground seen in that sector. On the map: the same figure at the tip of each spoke
  (`N 150 m`), a label on each ring, and one at the farthest ground seen — spokes are placed first
  and win a collision (`symbol-sort-key`), rings give way, and a label never sits within 40 m of the
  tower. Direction names are translated phrases with the preposition in them
  (`sightlines.compassTo.*`: "vers l'est", "nach Nordosten"), `compassShort.*` is the two-letter
  form (N, NO, O / NE, SE, SO), and German/Dutch use O/Z where English uses E/S.
- **Choosing a direction** (a row of the list, or its label on the diagram) opens
  `TerrainRaySection`: a section of the ground against the eyes (`TerrainRayChart`), the limit of
  sight over the crest, the hidden stretches shaded, the crest and the place ground returns marked
  with their heights, and a few sentences built from the same numbers. The line is drawn on the map
  too — seen stretches solid, hidden ones dotted — and a cursor on the section is a dot on the map.
  Eight compass lines only (`z.enum`), never a free bearing, so the number of answers is bounded.

### Where it is seen from — the reverse relation

A person on the ground can see the tower wherever a sentry on the platform could see that person:
line of sight is symmetric. The reverse view is therefore the same walk with the **tower's overall
height** (platform + 2.5 m of parapet and roof: 8.5 / 10 / 11 m, inside the "10 to 12 m" the
Bavarian sources give) as the eye and **a person's eye (1.6 m)** as the thing looked at — one more
column of comparisons in `castSightlines`, not another walk. It is a toggle on the diagram and the
map ("What it sees" / "Where it is seen from"), in a slate blue where the view is amber. On Turm
15-25b: 28.3 km², to 10 km east — close to the forward figure, as it should be, because the heights
are close; the two differ by exactly the difference between a sentry's eyes and the tower's top.

### What a sector's towers do together — chain, watch, blind stretches

Computed by **`pnpm sightlines:build [slug…]`** (`scripts/sightlines/build-sector-sightlines.ts`),
not on a request: a viewshed from every tower and a sight line between every pair within 6 km. It
reads the towers on a sector by the same 1,500 m rule, folds twin records, walks the towers in a
nearest-neighbour order (so consecutive towers share terrain tiles), and writes
`limes_sector_sightlines` (migration `0034`: `sector_slug` primary key — **no foreign key**, because
`import:limes` rebuilds the sector ids — `model_version`, `computed_at`, `summary` jsonb, `layers`
jsonb).

- **Twin records are one post.** A timber and a stone phase 18 m apart (Turm 15-25a and 15-25b) fold
  into one within 60 m, or a link of eighteen metres that is always clear would tell nothing and one
  tower would count twice in every share. Upper German 295 records → 238 towers; Raetian 84 → 55.
- **The chain has no order of its own.** A first design ordered towers by `ST_LineLocatePoint` along
  the sector's path and found 23 of Hadrian's Wall's 27 towers at offset 0: `path_geom` is only the
  _longest run_, and everything beyond it clamps to its end (the limes section above notes the same
  clamp). The chain is therefore a **minimum spanning tree** of the towers — each to its nearest, which
  for a frontier is the line, with a branch where two lines run side by side — and a stretch is
  covered when its two ends are in one component of the clear-link graph, **directly or round a
  blocked post by a longer link**, which is how a chain of beacons skips a tower in a hollow. Edges
  longer than 6 km are _gaps in the records_, counted and not tried.
- **The watch.** One cell grid (200 m) per sector, each tower adds the cells its polar grid sees;
  PostGIS dissolves the rectangles (`ST_UnaryUnion`, simplified at 0.0007° ≈ 80 m) into "seen from at
  least one tower" and "from three or more". The line itself is sampled every 100 m, **only where a
  tower could reach it** — beyond 10 km of every recorded tower it is _unrecorded_, not blind, and is
  left out of the shares. A stretch under 300 m is noise in the terrain model.

- **Spacing against reach.** The same script reads, for each stretch of the chain, how much farther
  along the same line a tower of the same height would still have been seen (`readSpanReach`,
  `shared/utils/tower-spacing.ts`; summary field `spacing`, absent on rows built before it). One
  `traceRay` per height estimate from the first tower along the bearing to the second, platform
  height at both ends. **In sight:** the reach is the first sample not seen at or beyond the second
  tower, never less than the span. **Not in sight:** the first sample not seen from the start (ratio
  above 1). A hollow between two towers that see each other is not held against them. A ray that
  ends on missing terrain claims nothing and the pair is counted as left out; one open to the 10 km
  limit is `isReachCapped` ("at least"; its share is a ceiling and it is kept out of the "closest to
  limit" list). **Records under `TOWER_SPACING_MINIMUM_SPAN_METRES` (100 m) are one post** — a
  reconstruction stands 71 m from Turm 14-48 — and are left out like unreadable ones; the number is a
  parameter, not a finding. Fewer than `TOWER_SPACING_MINIMUM_PAIRS` (5) read pairs and the panel
  says so rather than printing a median.

  **What a high share does not prove.** Medians sit at 75–90 % almost everywhere, and the cause is
  as much geometry as intent: a tower on a crest or a brow has ground falling away behind it, so the
  end of its unbroken view is a short way past it whether or not anyone planned the spacing. The
  panel says so in `sectorWatch.spacingMeaning`. **No null model was run** (the same reading for
  points on the same line at random, or for the sector's ridgeline) — until one is, the figure
  describes how the posts sit against the relief and nothing about why. Medians of 0.75–0.90 across
  the three large sectors, against 2.4 on the Dacian Limes (five of six recorded pairs cannot see
  each other: the records are sparse), is the extent of what was measured (14 Oct 2026).

- **A seam is two samples at one distance.** The sector's line is a MultiLineString of nineteen
  parts for the Raetian Limes, and the last sample of one part and the first of the next carry the
  _same_ cumulative distance. The first version cut a blind stretch out of the samples by distance
  range and drew a 150 km chord across Raetia for a 400 m finding (found by looking at the map, not by
  a number: no figure was wrong). Runs are now split at part seams (`contiguousRuns`, tested) and a
  stretch carries the run it was found in, so it is cut by position in the list, not by distance.

Measured on the dev import (12 Oct 2026, Mapterhorn over the network, ~6 minutes for all):

| Sector                   | Towers (folded) | Chain crossed (low–high) | Breaks | Line in reach | Seen / by 3+ | Blind |
| ------------------------ | --------------: | -----------------------: | -----: | ------------: | -----------: | ----: |
| Upper German Limes       |        238 (57) |             93 % (92–93) |      9 |        414 km |  75 % / 42 % |    60 |
| Raetian Limes            |         55 (29) |             83 % (83–87) |      3 |        172 km |  69 % / 26 % |    41 |
| Hadrian's Wall           |          27 (0) |             65 % (65–65) |      5 |         95 km |  71 % / 33 % |    14 |
| Danube, Noricum–Pannonia |          13 (0) |             42 % (27–42) |      3 |        152 km |   47 % / 5 % |    20 |
| Dacian Limes             |          11 (0) |                      5 % |      5 |         90 km |   23 % / 3 % |    18 |
| Limes Tripolitanus       |           4 (0) |                     55 % |      1 |         12 km |  68 % / 12 % |     4 |

The small sectors are **not** findings about the frontier: eleven recorded towers on a 600 km line
say what was recorded. `TerrainSectorWatch` says "the towers that are recorded", prints the date and
the counts, and for a sector where no two neighbours are within range (Lower German, Transalutanus:
chain length 0) says there is no chain to read rather than printing 0 %.

**Licence.** The stored layers carry sub-lines of the sector's own geometry (the blind stretches),
which is ODbL. They are served only to the map overlay, with the frontier's own attribution and the
elevation credit on the source, as a produced work; `/api/data` is untouched, the table is joined to
nothing, and the summary carries only the midpoints of stretches. A reader wanting the polygons as
data does not get them from here. **Size:** the Upper German layers are 1.4 MB of JSON (the seen-ground
polygons are most of it); gzip brings it to a few hundred KB, and it is fetched only when the switch
is turned on. Raising `SIMPLIFY_DEGREES` is the lever if that matters.

**Production.** The table arrives with the migration; the data does not — run `pnpm sightlines:build`
on the host once after the deploy (it needs the terrain mirror, `NUXT_PUBLIC_BASEMAP_TERRAIN_URL`,
and the `limes_sectors` import), and again after `pnpm import:limes`. Until it has run the panel
shows no section.

### Serving

Both routes are addressed by record id only, **never a free coordinate** — the number of distinct
answers is the number of towers and tracings, the cache is complete after one pass, and neither
endpoint can be used as a general terrain calculator. `enforceRateLimit('expensive')` (30/min);
`cache-control: private, max-age=3600`; Valkey `sightlines:m{SIGHTLINE_MODEL_VERSION}:d{data}:a{atlas}:{id}`,
`sightray:m…:{id}:{compass}` and `profile:m{PROFILE_MODEL_VERSION}:d{data}:{id}`, a week for an answer and a day for a `null`.
**A terrain failure is a 503 and is never cached** ("we could not see" must not be stored as "there
is nothing to see"). Measured on the dev import: a tower 3.1 s cold including the tile fetches
(Mapterhorn over the network), 19 KB of JSON; a 9 km road 0.3 s; a 242 km line 1.3 s; a 1,011 km
line 3.9 s (≈120 tiles at a coarser zoom).

### On the map

`useSightlineOverlay` — a GeoJSON source and five layers under the site marks, attached like the
notebook's, with its state in `useState` so the component that fetched the answer and the canvas that
draws it do not know each other. **Amber, not oxide** (the one accent belongs to the selected site,
drawn beside it) and not bronze (a linear feature). A cursor on a profile is a dot on the map
(`probe`); "Fit it on the map" pads for the record sheet (the lower 76 % on a phone, the right 440 px
on a desktop). On a reading page there is no map, so the switch and the button are not rendered and
the polar diagram and the written sectors carry everything.

### Accessibility

The polar diagram and the profile are each one `role="img"` with a summary; the same figures are
written out (eight compass rows, the neighbour list, a stats list). The profile's cursor is a native
`<input type="range">` laid over the SVG, so arrow keys, a finger and a screen reader all work
without a custom widget; its value text is the readout. Directions are phrased per language
(`sightlines.compassTo.*` carries the preposition: "vers l'est", "nach Nordosten", "naar het
noordoosten"). Numbers go through `useTerrainFormat` (`Intl`), not `formatLength`, which writes a
full stop in every language.

### Not built — worth knowing why

- **Forts as targets** — a tower's relay ends at a fort, but no sourced height exists for a gate
  tower or rampart walk; the neighbour list is towers only.
- **Pleiades "tower-\*" reference places** — they have no record panel; a calculation hung on a
  popup is a separate decision.
- **Time-to-react** ("a rider at the edge of the view is N minutes away") — it needs assumed speeds
  nobody sourced.
- **Woodland** — a canopy-height raster (ETH/Meta, CC BY 4.0) would let the calculation be run
  "with trees"; Roman-period land cover is not known, so it would be a sensitivity test, not a
  reconstruction.
- **Per-sector heights** — one model for every frontier. The sources do not support a distinction
  finer than "timber, then stone, about 10 m".
- **Live recalculation of a sector.** `pnpm sightlines:build` is run by hand (and after
  `import:limes` or a bulk change to the tower records); nothing watches for stale answers, only the
  printed date and tower count say how old one is.
- **A cached warm-up of the 447 single towers.** The first reader of a tower pays 1–3 s; a script
  walking the ids would fill the cache and is worth writing if the cold path shows up in the
  latency dashboard.
