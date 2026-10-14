# Line of sight and relief — what the towers could see, and the ground along a line

**Status (12 Oct 2026): built and verified on the dev import; nothing committed; e2e specs written,
not run.** This is the narrative: what the feature is, what it stands on, what it assumes, what it
found and what it does not claim. The terse maintainer's rules (paths, cache keys, invariants) are in
[`.claude/rules/sightlines.md`](../.claude/rules/sightlines.md); the one-paragraph version is
`summary.md` §5.11.

It began as idea 3 in a list of "what the project must have": _use the elevation you already serve_.
That idea was **an elevation profile along a tracing and a line of sight from the limes
watchtowers**, and it was then extended by three amendments:

1. **a chain statistic per sector** — could a signal pass from tower to tower along the line?
2. **a cumulative viewshed per sector** — which ground is overlooked by one tower, by three?
3. **the reverse view** — from where could a tower be seen?

---

## 1. What a reader gets

| Where                                      | What                                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A limes watchtower's panel / page          | "What the tower could see": a polar diagram with its figures written on it, the view by compass point, the neighbouring towers (in sight or not, with the ground between), and a switch to turn the view round.  |
| A direction (a row, or its label)          | "Looking to the north": a section of the ground against the sentry's eyes, the crest that ends the open view, the dead ground behind it, where ground comes back — in sentences built from the same numbers.     |
| The map, with a tower open                 | The same shapes and the same numbers drawn on the ground: ground seen, the unbroken outline at three heights, distance rings, the figure at each spoke, the farthest ground seen, the chosen line, a cursor dot. |
| A limes sector (panel and `/limes/<slug>`) | "Watching the frontier": how much of the line of towers a signal could cross, where it breaks, how much of the line and country is overlooked by one tower and by three, and the stretches nothing overlooks.    |
| The map, with a sector open                | The chain (clear links, links joined round a blocked tower, breaks), the overlooked ground in two depths, and the blind stretches.                                                                               |
| Any line tracing (panel / page)            | "Relief along the line": elevation against distance, climb, fall, average and steepest slope, a cursor that is also a dot on the map.                                                                            |

Everything is labelled **Calculated**, and "How this is worked out" is one tap away. None of it is a
record: no contributor wrote it, nothing is stored per reader, no consent question arises.

---

## 2. What it stands on: the terrain

### 2.1 The tiles

One source for everything: the **elevation tiles the hillshade and "About this spot" already read**
(`server/utils/terrain.ts`) — the production mirror `terrain-z12-*.pmtiles` (25°W–80°E, 12°N–66°N),
or Mapterhorn's own tiles in development. Terrarium encoding: `metres = R·256 + G + B/256 − 32768`,
so the encoding itself resolves **1/256 m** and is never the limit.

### 2.2 Resolution: ~12 m per pixel, and what that means

A z12 tile is **512 px square**. Pixel size is `40,075 km × cos(latitude) / (4096 × 512)`:

| Latitude         |  Pixel | Tile width |
| ---------------- | -----: | ---------: |
| 35° N (Sicily)   | 15.7 m |     8.0 km |
| 45° N            | 13.5 m |     6.9 km |
| 48.9° N (Raetia) | 12.6 m |     6.4 km |
| 50° N (Taunus)   | 12.3 m |     6.3 km |
| 55° N (Hadrian)  | 11.0 m |     5.6 km |

The mirror **stops at zoom 12**, so this is the finest the app can see. Consequences, in order of
how often they matter:

- **A ridge, a valley, a spur and a plateau edge are seen. A bank, a ditch, a wall, a hedge, a
  tree-line or a ruin mound are not**: anything narrower than about 12 m is averaged into its
  neighbours. The Limes' own earthworks (Teufelsmauer, ORL ditch and wall, Pfahlgraben) are mostly
  below the resolution.
- **A crest's position is good to about ±6 m horizontally and its height is smoothed.** Averaging
  into a pixel lowers a sharp peak: the earlier spot checks in `map-and-tiles.md` found the Zugspitze
  summit reading ~23 m low and five of six points within ~25 m. That is the right order for a ridge
  line of sight; it is not the right order for a 2 m margin.
- **Sampling.** Ray samples are 15 m apart, a little coarser than the pixel at 50° N, and read the
  tile **bilinearly across tile edges** (no steps at seams). A sample is not independent of its
  neighbours; a 15 m step cannot find an obstacle the pixel has already lost.

### 2.3 Elevation accuracy — what is known and what is not

- **Horizontal grid of the sources** (Mapterhorn's catalogue, `download.mapterhorn.com/attribution.json`,
  151 sources read on 12 Oct 2026): 0.25 m (Zürich, Baden-Württemberg ALS_3), 0.5 m (Wallonia,
  Switzerland swissALTI3D, Romania LAKI II, France LiDAR HD, Luxembourg), 1 m (all German Länder,
  Austria's ALS-DGM and Land models, Slovakia DMR 5.0, England, Scotland, Wales, Belgium-Flanders,
  Slovenia…), 5 m (the Netherlands AHN5 "lowresfilled", Czechia DMR 4G, Burgenland), 10–20 m (some
  national models), and **30 m Copernicus GLO-30** as the global fallback. Every one of these is
  resampled to ~12 m in the z12 tile.
- **Vertical accuracy of the sources** is not restated here as a measured fact. National airborne-lidar
  terrain models are generally good to a few decimetres on open ground and worse under dense
  woodland; Copernicus GLO-30 is specified at about 4 m (90 % linear error). **Both are from the
  products' general documentation and were not re-checked against a survey for this feature.** The
  only vertical check made in this project is the spot check above.
- **"Current height" is today's ground.** The model contains quarries, road cuttings and embankments,
  reservoirs, spoil heaps, field terracing, the ruin mounds of the towers themselves. A tower that
  stood on a spur now cut by a road is calculated on the cut spur. Nothing here reconstructs the
  Roman ground, and the ground under a tower was not the Roman ground to the metre.
- **Rule of thumb adopted (a judgement, not a measurement): treat a clearance of less than about
  3 m as undecided.** The three height estimates move a tower-to-tower line by 1.0–1.5 m on their
  own, and a 12 m pixel is a few metres of error at a crest. The panel's three-state link
  ("in sight at every height / unless the tower stood at the lower estimate / only at the higher
  estimate / hidden") is that rule made visible.

### 2.4 Bare earth, or trees?

"Suppose there are no trees" is mostly **a property of the data**, not an assumption:

- **Bare-earth lidar terrain models** (`DGM`, `DTM`, `MNT`, `MDT`, `DMR`, AHN) cover every German
  Land, Austria, Slovakia, Czechia, Slovenia, Switzerland, the Netherlands, England, Scotland and
  Wales, Romania, France, Spain, Poland, Belgium, Luxembourg and the Nordic states —
  `BARE_EARTH_COUNTRY_CODES`.
- **Where there is no open national model the tile falls back to Copernicus GLO-30, a _surface_
  model**, in which woodland and buildings are ground: **Hungary, Serbia, Bulgaria, Croatia,
  Turkey, Syria, Jordan** among the limes countries. There "no trees" is false; the panel prints a
  caution (`isBareEarthLikely`, judged from the tower's country code, not from the tile).
- **The source of an individual pixel is not recorded in the tile**, and coverage inside a country
  can be partial (Romania's 0.5 m survey is). A roughness check on a z12 tile over the forested
  Taunus gave a mean absolute Laplacian of 0.78 m at ~12 m pixels, as smooth as open ground —
  consistent with bare earth, not proof.

---

## 3. What it assumes: the tower

### 3.1 The current model

No tower stands to its original height, so every figure is a reconstruction.
`TOWER_HEIGHT_MODEL` (`shared/utils/sightline.ts`):

| Quantity                                     | Low | Middle | High | Notes                                                                                    |
| -------------------------------------------- | --: | -----: | ---: | ---------------------------------------------------------------------------------------- |
| Guard platform above the ground              | 6.0 |    7.5 |  8.5 | high = the Idstein-Dasbach replica's own gallery                                         |
| Sentry's eye above the platform              | 1.6 |    1.6 |  1.6 |                                                                                          |
| **Eye above the ground** (what is cast from) | 7.6 |    9.1 | 10.1 | `towerEyeHeights()`                                                                      |
| Parapet and roof above the platform          | 2.5 |    2.5 |  2.5 | only for the tower as something to be _seen_                                             |
| **Whole tower** (what an onlooker sees)      | 8.5 |   10.0 | 11.0 | `towerTopHeights()`; the middle is "usually about 10 m", the high is inside "10 to 12 m" |
| Thing looked at (a person)                   | 1.7 |    1.7 |  1.7 | a rider's head is higher, a crouching raider's lower                                     |
| Onlooker's eye (the reverse view)            | 1.6 |    1.6 |  1.6 |                                                                                          |

**Curvature and refraction** are taken off the terrain, not added to the eye: `(1 − 0.13)·d²/2R`,
which is **6.8 m at 10 km** (the size of the tower). 0.13 is the textbook coefficient for ordinary
conditions, a mean, not a measurement of any day.

### 3.2 Where the height figures were taken in

Read on **12 Oct 2026**. None is a measurement of an excavated structure.

| Source                                                           | What it says                                                                                                                              | How it was used                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| limesseiten.de `/LIMES/TUERME.HTML`                              | "the towers' height was usually about 10 metres"; no tower fully preserved, form a guess from Trajan's Column                             | the middle estimate (10 m overall)                     |
| gunzenhausen.info `/roemer/wachtuerme/`                          | "roughly 10 to 12 m"; ground floor storeroom, first floor living, second upper floor the guard room; base ca. 5 m square                  | the upper bound of the overall height                  |
| de.wikipedia, _Limeswachturm Wp 3/26_ (Idstein-Dasbach, 2001–02) | replica under the Saalburg museum's supervision: about 13 m, three storeys, **guard gallery at 8.5 m** (footnoted "private measurements") | the high platform; the only height with a floor stated |
| theromangaskproject.org (Woolliscroft)                           | the intervisibility analysis uses each tower's "likely full original height"; tests "even from a 10 m tower"                              | a consistency check on 10 m; no number to take         |
| English Heritage (Denton Hall, Banks East turrets)               | two or three storeys, "impossible to be certain"; an open parapet or a pitched roof; ~6 m _square_                                        | the low platform's two-storey case; no height          |
| museumhogewoerd.nl (Leidsche Rijn timber tower)                  | reconstruction from the 2002 excavation "supplemented with information from Trajan's Column"; corner posts survived "up to a metre high"  | none: it states no height                              |
| A 16 m figure for the Hillscheid stone tower                     | a heritage-site summary, uncited                                                                                                          | **left out** — nothing stands behind it                |

**Not found:** the heights drawn on Trajan's Column (no source gave any); a sourced turret height for
Hadrian's Wall (a search summary attributed "about 10 m" to an English Heritage school resource; the
page was not opened and the figure is not relied on).

The shape of it: _a tower about 10 m high, the guard platform three-quarters of the way up (the rest
is parapet and roof), a sentry's eyes 1.6 m above that._ One model for every sector; the sources do
not support a finer one ("timber, then stone, about 10 m").

### 3.3 Changing it

Edit `TOWER_HEIGHT_MODEL`, **bump `SIGHTLINE_MODEL_VERSION`** (it is part of every cache key; it is 3
today), and re-run `pnpm sightlines:build`. The sector table carries `model_version`.

---

## 4. What it calculates

### 4.1 One tower

`castSightlines`: **720 rays (0.5°), 15 m steps, out to 10 km, 479,520 samples**, every observer
sharing one walk over the terrain. Along a ray the steepest rise of the ground so far is kept; a
point is seen when its top clears that angle.

| Idea                      | Meaning                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unbroken view**         | distance to the first point not seen; one shape round the tower (three, one per height)                                                                                                            |
| **Seen at all**           | everything seen, including ground that comes back into view beyond a rise; kept as a **polar grid** of 1° × 100 m cells (a cell counts as seen when at least half its samples were), 4.5 KB base64 |
| **Farthest ground seen**  | the farthest seen sample, whichever ray                                                                                                                                                            |
| **Dead ground**           | the hidden stretch short of the farthest ground seen; `describeRay` reports the _first obstruction_ and the _longest hidden stretch_ with the crest that casts it, and where ground returns        |
| **Tower to tower**        | the straight line eye to eye against the terrain with the earth's bulge `d(D−d)/2R` added, at all three heights, for the six nearest towers within 5 km; symmetric                                 |
| **Where it is seen from** | the same walk from the tower's top at an onlooker's eye height (sight is symmetric); a toggle on the diagram and the map                                                                           |

**"Unbroken" is not "seen"**, and the difference is the most useful thing the feature found. Turm
15-25b sits on the shoulder of a rim: 0.5 km² open, **28.1 km² seen**. Reading only the unbroken view
makes it look blind; it is short-sighted in the near field and has a long reach. See §7.

### 4.2 The profile along a line

`samplePolyline` walks `ST_LineMerge(geom)` at ≥ 25 m and at most 600 samples (parts joined end to
end, breaks recorded); missing readings are interpolated and the share present is reported.

- **Ascent and descent ignore wobbles under 3 m** (`ASCENT_NOISE_FLOOR_METRES`), or a flat road read
  at 30 m spacing becomes a hill.
- **The steepest stretch** is measured over at least 150 m **or one sample spacing, whichever is
  longer**, and that window is returned and printed: a 242 km aqueduct sampled every 405 m cannot name
  a 150 m gradient.
- **Read it for what it is: the ground a hand-traced line crosses, not the course of a channel.** An
  aqueduct follows a contour at a fraction of a per cent while the terrain it crosses varies by tens
  of metres. Aqueduct Istanbul (id 21512): 242 km, 291 m → 61 m, net **−230 m, −0.09 %**; the climb and
  descent totals (5.5 km and 5.7 km of "relief" along a line that falls 230 m) are not meaningful at
  that spacing and the net figure is.
- Long lines drop to a coarser zoom (more than 120 tiles → a lower zoom), so a 1,011 km line is read
  at far less than 12 m.

---

## 5. The four amendments, one by one

### 5.1 Amendment 1 — the chain: could a signal pass along the line?

**Not ordered by position along the sector's path.** The first design did that and found 23 of
Hadrian's Wall's 27 towers at offset 0: a sector's `path_geom` is only its _longest run_, and
`ST_LineLocatePoint` clamps everything past either end of it. The chain is therefore:

1. fold **twin records** within 60 m into one post (a timber and a stone phase are two records 18 m
   apart: Turm 15-25a and 15-25b);
2. take the **minimum spanning tree** of the towers — each to its nearest, which for a frontier is
   the line, with a branch where two lines run side by side — leaving out edges longer than 6 km as
   **gaps in the records** (counted, not tried);
3. a stretch is **covered** when its two ends are in one component of the clear-link graph —
   directly, or **round a blocked post by a longer link**, which is how a chain of beacons skips a
   tower in a hollow;
4. repeat at the low, middle and high height; the spread is printed.

### 5.2 Amendment 2 — the watch: which ground is overlooked?

One 200 m cell grid per sector; each tower adds the cells its polar grid sees (a window of ±10 km),
PostGIS dissolves the rectangles (`ST_UnaryUnion`, simplified at 0.0007° ≈ 80 m) into **"seen from at
least one tower"** and **"seen from three or more"**. The line is sampled every 100 m, **only where a
tower could reach it**: beyond 10 km of every recorded tower it is _unrecorded_, not blind, and is
left out of the shares. A stretch under 300 m is noise in the terrain model. The map layer is cut
from the sector's line (ODbL), is served only to the overlay with the frontier's own credit, and is in
no `/api/data` feed.

### 5.3 Amendment 3 — the reverse view

A person on the ground can see the tower wherever a sentry on the platform could see that person. The
reverse view is the same walk with the **tower's overall height** as the eye and **a person's eye
(1.6 m)** as the thing looked at: one more column of comparisons, not another walk. On Turm 15-25b the
two figures are 28.1 km² and 28.3 km², as they should be — the heights are close.

### 5.4 Amendment 4 — the spacing: as far apart as the ground allowed?

For each stretch of the chain (the spanning edges within 6 km), a ray from the first tower along the
bearing to the second, at the middle height at both ends, says how far past the second tower a tower
could still have stood and been seen: **the reach**. Actual spacing ÷ reach is the share a pair uses; 1
is as far as the ground allowed, and above 1 the two cannot see each other. Run at the low and high
height estimates too, so the median carries the same range as the chain. `shared/utils/tower-spacing.ts`,
tested on synthetic terrain; stored in the sector summary (`spacing`), shown in `TerrainSectorWatch`
as a ten-bin histogram, the median, the pairs nearest the limit and the pairs far inside it.

Two decisions worth knowing. A pair that sees each other across a hollow is **not** penalised for the
hollow: the reach is counted outward from the second tower, which stands where ground returns. And
records within 100 m are one post (a reconstruction at 71 m was the third-lowest ratio on the Raetian
Limes) and drop out.

**What the figure cannot tell.** A tower on a crest has ground falling away behind it, so its reach ends a
short way past it however the spacing was chosen; the 75–90 % medians below are partly that. No null
model has been run. The figure says how the posts sit against the relief, not why.

---

## 6. Results on the dev import (12 Oct 2026)

Which sites are towers: 6,914 records are filed `watchtower`; **5,720 are Sardinian nuraghi**
(period −3300); **447** stand within 1.5 km of a limes sector (Upper German 295 records, Raetian 84,
Hadrian's Wall 27, Danube N–P 13, Dacian 11, Transalutanus 6, Tripolitanus 4, Claustra Alpium 4,
Lower German 2, Antonine 1).

| Sector                   | Towers (folded) | Chain crossed (low–high) | Breaks | Line in reach | Seen / by 3+ | Blind | Overlooked |
| ------------------------ | --------------: | -----------------------: | -----: | ------------: | -----------: | ----: | ---------: |
| Upper German Limes       |        238 (57) |             93 % (92–93) |      9 |        414 km |  75 % / 42 % |    71 |  3,309 km² |
| Raetian Limes            |         55 (29) |             83 % (83–87) |      3 |        172 km |  69 % / 26 % |    42 |  1,202 km² |
| Hadrian's Wall           |          27 (0) |             65 % (65–65) |      5 |         95 km |  71 % / 33 % |    14 |    606 km² |
| Danube, Noricum–Pannonia |          13 (0) |             42 % (27–42) |      3 |        152 km |   47 % / 5 % |    39 |    360 km² |
| Dacian Limes             |          11 (0) |                      5 % |      5 |         90 km |   24 % / 4 % |    18 |    310 km² |
| Limes Tripolitanus       |           4 (0) |                     55 % |      1 |         12 km |  68 % / 12 % |     4 |    169 km² |

**Spacing against reach** (14 Oct 2026; median share of reach, middle estimate, low–high in
brackets, pairs read / out of sight / reach capped at 10 km):

| Sector                   | Median share (low–high) | Read | Out of sight | Capped | Median spacing / reach |
| ------------------------ | ----------------------: | ---: | -----------: | -----: | ---------------------- |
| Upper German Limes       |            78 % (82–77) |  220 |           23 |      3 | see panel              |
| Raetian Limes            |            75 % (78–74) |   43 |            4 |      0 | 1,210 m / 1,733 m      |
| Hadrian's Wall           |            89 % (96–87) |   23 |            5 |      0 | see panel              |
| Danube, Noricum–Pannonia |            77 % (98–72) |    8 |            3 |      0 | see panel              |
| Dacian Limes             |         237 % (244–230) |    6 |            5 |      0 | records too sparse     |

Claustra Alpium, Lower German, Transalutanus and Tripolitanus have fewer than five readable pairs and
print no median.

**Read these as what was recorded, not as the frontier.** Eleven recorded towers on a 600 km line say
what was recorded. Hadrian's Wall had about 160 turrets (two between each of eighty milecastles); 27
are recorded here. Lower German, Transalutanus and Claustra Alpium have no two neighbours within 6 km,
and the panel says there is no chain to read rather than printing 0 %.

---

## 7. Worked examples

### Turm 15-25b (id 781; 48.907 N 11.600 E; ground 463 m; eyes 472.3 m) — a rim

| Quantity (middle estimate)   | Value                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| Open view / longest unbroken | 0.5 km² (0.3–0.5) / 1.3 km to the SSW; every sector closes at 140–390 m     |
| Seen at all                  | **28.1 km²** (9 % of 314 km²); farthest ground seen **10.0 km to the east** |
| Seen from                    | 28.3 km² (27.3–29.0)                                                        |
| Neighbours                   | all six in sight at every height                                            |

Along the line due north (25 m steps):

| Distance |  Ground | Against the foot | Against the eyes | Seen                                              |
| -------- | ------: | ---------------: | ---------------: | ------------------------------------------------- |
| 60 m     | 467.5 m |           +4.3 m |           −4.8 m | yes                                               |
| 125 m    | 469.7 m |           +6.7 m |           −2.4 m | yes — the crest                                   |
| 300 m    | 458.6 m |           −4.7 m |          −13.8 m | no                                                |
| 720 m    | 401.0 m |          −62.2 m |          −71.3 m | no — the valley floor (Schambach)                 |
| 1.7 km   |   494 m |          +30.8 m |          +21.7 m | yes — the far side, which hides the rest to 10 km |

A rise 2.4 m _below_ the eyes is enough: ground that drops away behind it falls under the line of
sight over its top. The long shadow is cast by the ridge across the valley. Whether the 125 m rise is
natural or the limes' own earthworks, the model cannot say.

### Turm 3-25 (id 840; Taunus; 320 m) — a shut-in ridge tower

2.3 km² open, 8.3 km² seen, longest run 1.9 km to the SW; five of six neighbours in sight, Turm 3-20
hidden by 48.7 m of ground 1.7 km along. Short views, short reach: nearly all of its value is in the
chain.

### Hungarian Danube (id 2334) — a surface model

11.3 km² open, 45 km² seen, but on a surface model: woodland counts as ground, so these are a
_pessimistic_ view of what a sentry had. The panel says so.

---

## 8. Cost and plumbing

| Thing                   | Measured / decided                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One tower, cold         | ~3 s on the dev import including fetching ~16–25 terrain tiles over the network; cached a week (`sightlines:m3:d{data}:a{atlas}:{id}`)                                                        |
| One compass line        | ~0.7 s uncached with the tiles in memory, ~10 ms cached (`sightray:m3:…:{id}:{compass}`); eight compass lines only, never a free bearing                                                      |
| A profile               | 0.3 s for a 9 km road, 1.3 s for 242 km, 3.9 s for 1,011 km (`profile:m2:d{data}:{id}`)                                                                                                       |
| Payloads (compact JSON) | tower **31 KB** (incl. two 6 KB polar grids), compass line 5 KB, profile 12–19 KB, sector summary 10–34 KB, **sector layers up to 1.4 MB** (Upper German), fetched only when the switch is on |
| Sector build            | `pnpm sightlines:build`: ~100 s for the Upper German Limes (238 towers, ~1,000 sight lines, ~1 M grid cells), ~6 min for every sector, almost all of it fetching tiles                        |
| Storage                 | `limes_sector_sightlines` (migration `0034`), 9 rows, ~0.8 MB; no foreign key (`import:limes` rebuilds the sector ids)                                                                        |
| Rate limits             | tower and profile `expensive` (30/min); compass line and sector routes `enrichment` (60/min)                                                                                                  |
| In-memory               | 48 decoded tiles (1 MiB each), least-recently-used                                                                                                                                            |
| Production              | the table arrives with the migration, the **data by dump** (runbook §14c); never run the script on the VPS                                                                                    |
| Privacy                 | no personal data, no storage, no third party; `privacy.cookiesBody` unchanged                                                                                                                 |

---

## 9. What it does not claim

- **It is geometry, not eyesight.** Haze, weather and the limit of what an eye can make out cut a real
  view short. At 2 km one arcminute — the usual figure for the eye's acuity — is 0.6 m, about the width of a
  person; a column of riders or a smoke is another matter and reads from much farther. The 10 km radius is a limit of the
  model, not of the eye.
- **It is not reconstruction of the ground** (§2.3) and **not of the vegetation** (§2.4 — Roman-period
  land cover is not known; a canopy raster would make a sensitivity test, not a reconstruction).
- **It is about the towers that are recorded.** An unrecorded stretch is unrecorded, not unwatched.
- **Forts are not targets** (no sourced height for a gate tower or rampart walk), and Pleiades
  "tower-*" reference places are not towers here.
- **"Sited for the chain, not for the outlook" is an interpretation**, hedged where it is made.
- **No time-to-react** ("a rider at the edge of the view is N minutes away"): it needs assumed speeds
  nobody sourced.

---

## 10. Where it lives

```
shared/utils/sightline.ts        height model, castSightlines, traceRay, describeRay, traceSightLine
shared/utils/seen-grid.ts        the polar grid: pack, runs, lookup, wedge rings
shared/utils/sightline-overlay.ts what the map draws, with the figures at their places
shared/utils/sector-watch.ts     twins, spanning tree, components, coverage grid, rectangles
shared/utils/tower-spacing.ts    reach of a span, spacing ratio, the sector's spacing summary
shared/utils/elevation-profile.ts sampling a polyline, statistics
server/utils/terrain.ts          tiles → elevationAt(lon, lat), 48-tile LRU, bilinear across seams
server/utils/sightlines.ts       which sites are towers, neighbours, assembling the answer
server/utils/elevation-profile.ts
server/api/sites/[id]/sightlines.get.ts, sightlines/ray.get.ts
server/api/tracings/[id]/profile.get.ts
server/api/limes/sectors/[slug]/sightlines.get.ts, sightlines.geojson.get.ts
scripts/sightlines/build-sector-sightlines.ts   `pnpm sightlines:build [slug …]`
app/components/terrain/          TerrainTowerSightlines, TerrainSightRose, TerrainRaySection,
                                 TerrainRayChart, TerrainSectorWatch, TerrainTracingProfile,
                                 TerrainProfileChart
app/composables/terrain/         useTowerSightlines, useTowerRay, useSectorWatch, useTracingProfile,
                                 useTerrainFormat
app/composables/map/             useSightlineOverlay, useSectorWatchOverlay
e2e/sightlines.spec.ts           written, not run
```

Unit tests sit beside the code (`shared/utils/__test__/`, `server/utils/__test__/terrain.test.ts`):
synthetic terrain for the geometry (flat ground, a ridge, a low bank only a higher platform sees past,
a rim with dead ground, a hummock before a valley, terrain that runs out), packing, runs, twins,
spanning tree, components and coverage rectangles.

---

## 11. Open points

- **Run the e2e specs** (`e2e/sightlines.spec.ts`) — written against the dev import's records and not
  run, per the project rule.
- **Warm the cache** for the 447 towers if the cold path shows up in the latency dashboard.
- **Sector data in production** is a dump restore; a stale answer after `import:limes` is possible and
  only the printed date and tower count say so.
- **A measured vertical check** of the z12 tiles against a survey near a limes tower would turn §2.3
  from "general documentation" into a number.
- **A null model for spacing** (§5.4): the same reading for random points along the line or along the
  ridgeline would say how much of the 75–90 % is siting on crests and how much is intent.
- **Forts as relay targets** need a sourced height first.
- **Layer size** (1.4 MB for the Upper German Limes) is tunable by `SIMPLIFY_DEGREES` in the script.
