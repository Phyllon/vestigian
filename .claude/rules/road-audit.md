---
paths:
  - 'scripts/audit/**'
  - 'server/database/schema/road-audit.ts'
  - 'server/utils/road-audit.ts'
  - 'server/utils/reference-layers.ts'
  - 'server/api/road-audit/**'
  - 'shared/utils/road-audit.ts'
  - 'app/composables/map/useReferenceOverlays.ts'
---

## The road audit — what stands beside a conjectured road (built 14 Oct 2026)

Itiner-e (`antiquity_roman_roads`) is 93% conjectured or hypothetical by segment
count. The audit reads each of those 13,729 segments against the rest of the
atlas and says what it finds: **evidence, never a verdict.** Itiner-e's own
`certainty` stays the source's statement; nothing here re-grades a road, and a
count of zero says only that nothing is recorded there.

`pnpm roads:audit` writes `road_audit_segments` and `road_audit_gaps`
(`server/database/schema/road-audit.ts`); the overlay (`road-audit` in the
overlay menu) and two CSV downloads read them. Pure rules — buffer, thresholds,
ranking — are `shared/utils/road-audit.ts`.

### What counts, and why those numbers

| Evidence                                          | Source                                            | For / against |
| ------------------------------------------------- | ------------------------------------------------- | ------------- |
| Located EDH milestones within 300 m               | `inscriptions` (`inscription_type = 'milestone'`) | for           |
| vici.org milestone records within 300 m           | `sites` (`subcategory = 'milestone'`)             | for           |
| vici.org road records within 300 m                | `sites` (`subcategory = 'road'`)                  | for           |
| How many of its two ends meet a `certain` segment | `antiquity_roman_roads`                           | context       |
| Steepest 250 m stretch on the terrain model       | Mapterhorn terrain, zoom 10                       | against       |
| Milestones farther than 1 km from every road      | the two milestone sources                         | reverse       |

- **The buffer is 300 m, not the plan's 200 m**, because the data said so: the
  median distance from a located milestone to the nearest Itiner-e road is 261 m
  (vici, 1,003) and 307 m (EDH, 160). A 200 m buffer misses more than half the
  stones that do belong to a road. `ROAD_AUDIT_BUFFER_METRES`.
- **Only 160 of 1,683 EDH milestones have a position.** EDH's findspots resolve
  only where the modern place is unambiguous (`12-edh-inscriptions.ts`), and
  milestones are found in the country. This is the headline limit: the "for"
  evidence is vici's 1,003 records (2 within 300 m of an EDH one — they are
  almost disjoint) plus 160. Of all 1,163, 73% lie within 1 km of a road; only
  5 EDH milestones lie within 500 m of a _certain_ segment.
- **Located milestones are findspots, often modern re-use sites** (spolia, a
  church step, a farm gate). The popup and both CSVs say so. A milestone far from
  every road is a question — a moved stone, a road the model lacks, a misplaced
  coordinate — and is listed as one.
- **Steep is calibrated, not cited.** `ROAD_AUDIT_STEEP_GRADIENT_PERCENT` is the
  99th percentile of the steepest 250 m stretch over the 967 surveyed segments
  on the same terrain: 35.9% at zoom 10 (the 95th is 23.7%). It means "steeper
  than 99 in 100 surveyed segments read this way" and nothing about Roman
  engineering. **Even surveyed roads read 24% at the 95th**: a digitised line
  that crosses a valley picks up its walls, and a 54 m pixel is not a road bed.
  Conjectured segments run heavier (median 9.0%, 95th 35.6%, 99th 57.7%) —
  suggestive, not a measurement of anything Roman. 640 of them (4.7%) pass
  the threshold, 552 with nothing recorded near. **The constant is tied to the
  terrain zoom**; `pnpm roads:audit -- --zoom 12` prints the new percentile and
  the constant has to move with it. The threshold is read at tile and download
  time, not stored, so changing it needs no rebuild (bump the atlas version for
  the tiles).
- **Steepest-stretch is an extreme value**, so a 190 km segment has far more
  windows to be steep in than a 2 km one — measured: 1.0% of segments of 1–5 km
  pass the threshold, 3.4% of 5–20 km, 6.6% of 20–50 km, 14.7% of those over
  50 km. Steep ones are therefore ordered by gradient, not length, and the
  download carries `length_m` beside the flag. Samples are a fixed 50 m so the
  window is the same 250 m on every segment (a first build capped the count at
  400, which widened it on long segments to several times that).
- **The terrain is a free public service.** Zoom 10 is 5,212 tiles from
  Mapterhorn (~700 MB). The script keeps each on disk under `.import/terrain/`
  so a re-run asks nobody; for anything routine point
  `NUXT_PUBLIC_BASEMAP_TERRAIN_URL` at the mirror. `--no-slope` skips terrain
  entirely (counts and gaps in 8 s).

### What was left out, and why

- **River crossing with no bridge** (in the plan). The database has no river
  geometry: `antiquity_water` is inland-water and sea polygons, and rivers exist
  only in the basemap's vector tiles. The bridges it would be tested against are
  368 AWMC records and a few hundred Wikidata monuments for a continent, so a
  crossing "without a bridge" would be nearly every crossing — evidence of how
  little is recorded, not of the road. Not built.
- **A Tabula Peutingeriana leg on the same line** (in the plan). Its legs are
  endpoint pairs, not courses, and the whole dataset sits behind an operator
  switch (`NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED`) that a tile layer built
  from it would bypass. See `tabula-peutingeriana.md`.
- **Matching ORBIS** adds no independent support: see
  `documents/cross-data-feature-plan.md` (88% of ORBIS road length lies on
  Barrington roads, the same base Itiner-e draws on).

### The overlay

One overlay, `road-audit`, in the shared reference system
(`reference-overlays.md`): two MVT layers in one tile, `audit_segments` and
`audit_gaps`. **The tile carries only the segments there is something to draw
for** — a find nearby, or steep — because the other ~90% are Itiner-e's own,
drawn by `roman-roads`, and carrying them again would triple the tile.

- **Verdigris** line = a milestone or road record stands within the buffer
  (verdigris is the brief's colour for a confirmed state). **Dotted dark** line =
  steep. Deliberately not red/green: the supported colour must not read as
  "good" nor the dots as "bad". **Bronze ring** = a milestone far from every road.
- **One wide invisible line takes the click** (the drawn ones are 1.5–3 px).
  `roman-roads` yields its own popup where the audit's answers the same click
  (`isAnsweredElsewhere`) — otherwise two handlers race and whichever overlay
  was switched on last wins.
- The segment popup lists the finds by kind, whether an end meets a surveyed
  segment, the steepest stretch with its window, and a standing caveat. Strings
  `roadAudit.*`, key `legend.roadAudit*`, six locales.
- Downloads: `/api/road-audit/segments.csv` (ranked: a conjectured road with
  nothing beside it first, hypothetical behind, steep before flat, longer before
  shorter — `compareForAuditList`) and `/api/road-audit/gaps.csv`. **Not under
  `/api/data/`**: that path is the project's CC BY-SA / CC0 reuse feed and this is
  Itiner-e (CC BY 4.0), EDH (CC BY-SA 4.0), vici.org (CC BY-SA 3.0) and terrain
  together. CSV fields that begin `=`, `+`, `-` or `@` are prefixed, since a
  title is somebody else's text and a spreadsheet will run it.

### Keeping it true

- **`pnpm import:itinere-roads` empties `road_audit_segments`** in the same
  `TRUNCATE` that resets the road ids (`RESTART IDENTITY` reassigns them; there is
  no foreign key for that reason). Run the audit again afterwards. The gaps table
  does not depend on road ids, but its distances do, so rebuild it too.
- Also rebuild after the EDH or vici records change in bulk, or when
  `ROAD_AUDIT_MODEL_VERSION` moves. `refreshAtlasCache(['reference:road-audit:*'])`
  runs at the end of the build.
- A code-only change to the tile SQL needs `INCRBY` on `vestigian:atlas-version`
  (see `reference-overlays.md`).
