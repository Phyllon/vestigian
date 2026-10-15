# Cross-data features — plan for a fresh session

Written 2026-10-14 after a brainstorm on what the imported datasets can answer
together, in the way the limes tower sightlines do. **A, B1 and C are built (14 Oct 2026);
the rest is not.**
Schema columns were checked against `server/database/schema/`; row quality and
match rates were **not** measured — each item says what to measure first.

Read first: `CLAUDE.md`, `.claude/rules/sightlines.md` and
`documents/line-of-sight-and-relief.md` (the pattern to copy: geometry pure and
tested in `shared/`, a thin `server/utils/` assembler, a "Calculated" tag and a
"How this is worked out" note, nothing stored about a user). Reference data
rules: `.claude/rules/reference-overlays.md`, `import-pipeline.md`.

Project rules that bite here: arrow functions only; interface for >2 params;
i18n in all six locales, hand-written (never `pnpm i18n:translate`); no
nested ternaries; unit tests only for composables/server utils/shared utils;
Drizzle by default, raw SQL for PostGIS only; verify any new external source's
licence with a real request; update `.claude/rules/`, `documents/` and add a
changeset; **do not commit** unless asked.

## Recommended order

1. **A — Tower spacing vs intervisibility** (cheap, extends existing code)
2. **B — Tabula Peutingeriana miles vs measured road length**
3. **C — Conjectured-road plausibility audit** (shares B's road matching)

**D and F are scoped below (15 Oct 2026, measured on the dev database)** — read their
"Measured" blocks before building: both changed shape once the data was queried. E and G–J
remain lower priority; scope against the data before building.

---

## A. Was tower spacing chosen for intervisibility?

**Built 14 Oct 2026** — `shared/utils/tower-spacing.ts`, the `spacing` field of
the sector summary, a section in `TerrainSectorWatch`; narrative in
`documents/line-of-sight-and-relief.md` §5.4, rules in `.claude/rules/sightlines.md`.
Deviations from the plan below: reach is counted _outward from the second
tower_ (the unbroken ground past it), not the farthest point seen at all, which
would be a far hillside; pairs under 100 m are one post; and the "sourced height"
precondition turned out to be only terrain readability — every tower uses the one
height model. **Medians 75–90 %, with an unmeasured crest-siting confound** — see
the rules file before quoting a number.

**Question.** For each limes sector, is the distance between consecutive towers
close to the maximum distance at which they are still intervisible?

**Data.** Towers = `sites.subcategory = 'watchtower'` within
`TOWER_FRONTIER_REACH_METRES` of a `limes_sectors.geom` (447 on the dev DB;
nuraghi excluded by that rule — see `sightlines.md`). Visibility:
`shared/utils/sightline.ts`, sampler `server/utils/terrain.ts`.
Sector precompute: `scripts/sightlines/build-sector-sightlines.ts`
(`pnpm sightlines:build`), table `limes_sector_sightlines`, UI
`TerrainSectorWatch`.

**Build.**

- Per tower pair that are neighbours along the sector: actual distance; the
  furthest point along the same bearing (or along the limes line) from which the
  tower's guard platform is still seen — i.e. maximum intervisible distance.
- Output per sector: ratio actual/max, distribution, outliers. Store beside the
  existing sector result rather than computing on request.
- Display in `TerrainSectorWatch` / `/limes/[slug]`: a small chart and the
  per-sector median. Say plainly what a high ratio would and would not prove
  (signalling is one reading; mutual surveillance of ground is another).

**Measure first.** How many consecutive pairs have both ends with a sourced
height (see the document for where heights come from); drop pairs without.

**Caveats.** Same terrain-model limits as the existing feature (surface vs bare
earth outside Mapterhorn's lidar countries). Report, don't hide, the sectors
with too few pairs.

---

## B. Do the Tabula's stated miles survive measurement?

**Question.** For each Tabula Peutingeriana edge, how does the stated distance
compare with the length of the same route along the Itiner-e road network, and
does the error depend on mountains, rivers or sea?

**Data.** Tabula edges: `tabula-peutingeriana.ts` — `distance_roman_miles`,
`over_water`, `crosses_mountains`, `crosses_river`, `is_reconstructed`,
`from_place_id`/`to_place_id`, line `geom`. Roads: `antiquity_roman_roads`
(Itiner-e; `certainty` certain/conjectured/hypothetical, `main`).
Tabula places carry `modern_name`, `symbol`, `geom`.

**Build.**

1. Snap each edge's two places to the Itiner-e graph (nearest node within a
   tolerance; skip and count what fails).
2. Shortest path on the segment graph; length in metres; compare with
   `miles × 1480 m` (state the mile used; report implied mile = path length /
   stated miles as the headline number).
3. Exclude `over_water` and `is_reconstructed` from the headline; show them
   separately. Weight or colour by the path's share of `certain` segments —
   an error measured along a hypothetical road is weak evidence.
4. Output: per-edge table + aggregate (median error, by flag). Surface as a
   reading page (follow `tabula-peutingeriana` page / `documents/`), and as an
   edge popup line ("stated 12 miles, ≈ 17.8 km along the road").

**Measure first.** Fraction of edges that snap; fraction of snapped edges whose
path is mostly certain. If under about half, say so and ship the smaller claim.

**Caveats.** Road geometry is modern reconstruction; a mismatch can be the
roads, the snapping, or the Tabula. The interface must not assert which.
Stage 2 needs a graph library or a PostGIS `pgRouting`-free approach — look for
an established open-source package first (project rule), then ask.

---

### B1 built; B2 measured, not built (14 Oct 2026)

**B1** is the Tabula road popup (stated miles → km, the calculated straight
line, crossings, reconstructed flag) — see `.claude/rules/tabula-peutingeriana.md`.
It needs no road network. Of 2,397 legs, 1,105 (46%) sit within −20%/+25% of
stated × 1,480 m against that line; the straight line is a lower bound.

**B2 measurements** (throwaway Dijkstra over every vertex of
`antiquity_roman_roads`, nodes rounded to ~11 m; endpoints snapped to the
nearest vertex; **the script was not kept**):

|                                                              | legs                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| both places within 5 km of the network                       | 2,111 (88%); within 1 km: 1,445 (60%)              |
| a path exists between the snapped nodes                      | 2,086 (87%)                                        |
| path at least half `certain`                                 | **105 (4.4%)**                                     |
| path length by certainty                                     | 5.5% certain, 93.7% conjectured, 0.8% hypothetical |
| with a figure, not reconstructed, not over water, path found | 1,931                                              |
| …of those, path / stated miles, median                       | 1.15 (47% within 0.8–1.25)                         |
| …the 99 whose path is mostly certain, median                 | 1.07                                               |

Read as: the network connects and snaps well enough to measure, but almost
nothing it measures along is road the dataset itself calls certain, so the
headline must be the smaller claim the plan already names. A 5 km snap
tolerance on a median 24 km leg is large; a build would need to report snap
distance and drop or flag legs beyond ~2 km (1,850 legs pass at 2 km).
**No pgRouting needed:** the whole graph (995k nodes) solves 2,400 legs in
under 4 s in plain Node, so B2 would be a script that writes a table, not an
extension in the Postgres image.

**ORBIS does not raise certainty.** Matching ORBIS road edges to Itiner-e was
measured: 37% of ORBIS road length (627 edges, 60,186 km) lies within ~500 m
of Itiner-e, only 3% within 500 m of `certain` segments — but 88% lies within
~500 m of Barrington roads (`antiquity_lines`, kind `road`), and 77–83% of
Itiner-e segments touch a Barrington road too. Proximity is not proof of
derivation, but the two share a base, so agreement between them is not
independent corroboration. Not verified: ORBIS's own documentation of how its
roads were drawn.

## C. Conjectured-road plausibility audit

**Built 14 Oct 2026** — see `.claude/rules/road-audit.md` for what was counted,
every parameter and why, and what was left out (river crossings: no river
geometry in the database; Tabula legs: endpoint pairs behind an operator switch).
Measured first, as asked: only 160 of 1,683 EDH milestones are located; with
vici.org's 1,003 there are 1,163, of which 73% lie within 1 km of an Itiner-e
road and 5 EDH ones within 500 m of a `certain` segment. 1,209 of 13,729
conjectured or hypothetical segments have a milestone or road record within
300 m; 376 milestones are farther than 1 km from every road. On a 54 m terrain
model even surveyed roads read 24% at the 95th percentile of their steepest
250 m, so the steep threshold is that distribution's 99th (36%), not a number.
The original brief follows.

**Question.** Which conjectured/hypothetical Itiner-e segments look wrong, and
which have independent support?

**Evidence per segment** (all within a stated buffer, e.g. 200 m; make it a
named constant):

- **For:** EDH milestone findspots (`inscriptions.inscription_type`; check the
  actual vocabulary for milestones first), neighbouring `certain` segments,
  Tabula edge on the same line.
- **Against:** slope above a stated limit along the segment (reuse
  `shared/utils/elevation-profile.ts` / `server/utils/elevation-profile.ts`);
  a river crossing with no AWMC bridge or Wikidata bridge nearby.
- **Reverse:** milestone findspots farther than the buffer from every known
  road → "candidate missing road" list.

**Output.** A score or simply the two evidence lists per segment, never a
verdict word. A map overlay (extend the reference overlay pattern) and a
download. Rank by "conjectured with no support", which is the useful list.

**Measure first.** Milestone count and how many fall near any road (that is also
the headline finding); how noisy slope is on 30 m terrain for short segments.

**Caveats.** Inscription findspots are often modern re-use sites, not the road
(spolia); say so. Slope limits are a judgement — cite the source or label it
as a parameter.

---

## D. Did the water flow? (aqueduct gradients)

**Question.** For each traced aqueduct, is the ground the line follows consistent with a
channel that falls from intake to outlet at a gradient Roman engineers would have set — and
where is it not, which means a siphon, an arcade, a mis-drawn line, or a model error.

**Measured (dev DB, 15 Oct 2026).**

- `tracings` has **no subcategory** (vici's `line_kind` is a drawing type, and the importer
  deliberately files a tracing under its point's category — `02-mysql-to-postgres.ts`
  "importTracings"). An aqueduct line is therefore found two ways, both imperfect:
  title regex (`aqu?e?duct|aquädukt|aqueduc|wasserleitung|aqua `) → **176** approved lines;
  a `sites.subcategory = 'aquaduct'` point (857 such sites; the spelling is vici's) within
  ~50 m of a line → **87 more**. Union **263**, of which **148 ≥ 3 km, 119 ≥ 5 km, 86 ≥ 10 km**,
  about **9,700 km** in all. Restricted to `category = 'infrastructure'`.
- **The title test is not clean**: spot-checked names are mostly real ("Aqua Traiana",
  "Eifelwasserleitung") but the `aqua ` branch will catch spas (Aquae …) and a point-proximity
  match will catch roads that run past an aqueduct bridge. Read a random 30 before trusting it
  and say the false-positive rate in the page.
- Sampling and terrain are as for any profile: ~12 m pixels, `PROFILE_MINIMUM_STEP_METRES` 25,
  at most 600 samples, so a 100 km line is sampled every ~170 m. Vertical accuracy of the
  sources is **not** measured in this project (`line-of-sight-and-relief.md` §2.3).

**What a ground profile can and cannot say.** The terrain model is the _ground_, not the
channel. Under an arcade, in a tunnel, in a cut or on an embankment the channel is above or
below the ground by metres to tens of metres, so a point-by-point comparison is not valid.
Only the **end-to-end fall** (intake level − outlet level) over the line's length is
meaningful, and it is meaningful only if the two ends are where the channel starts and ends.
Direction is not stored: a drawn line runs whichever way the contributor drew it. Decide the
direction from the data (the lower end is the outlet) and **say that it was inferred**; a
line whose two ends are within the noise floor is reported "level — direction undecidable",
not given a gradient.

**Build.**

1. `shared/utils/aqueduct-gradient.ts` (pure, tested with synthetic profiles): from an
   `ElevationProfile` return end-to-end fall, mean gradient in m/km and as 1:n, the share of
   the line that climbs by more than the noise floor (`ASCENT_NOISE_FLOOR_METRES`), the
   longest run that climbs, and an uncertainty band. The band is a **parameter**, not a
   claim: `endpointUncertaintyMetres` (start with the ~4 m the document gives for GLO-30, 1 m
   where the line lies in a lidar country) applied to both ends, so the gradient is a range.
2. Take each end as the **median of the first/last 200 m**, not one sample, so a quarry or
   road cutting under the end vertex does not set the figure.
3. Compare against **Vitruvius VIII.6** (not less than half a foot in 100 feet, about 1:200,
   0.5 %) and state it as a _rule in a book_, not a measurement of practice — surviving
   aqueducts are commonly reported as much shallower (the Nîmes line is the usual example;
   **a figure from memory, check it against a source before printing it**), which would
   itself be the finding worth showing. Cite the source passage in the page; verify the translation used.
4. Flag, never judge: "climbs 14 m over 2.1 km" → "siphon, arcade over a rise, or line error".
   Cross-check with the AWMC/Wikidata aqueducts and `bridge` sites on the line as _evidence
   for an arcade or siphon_ (not proof).
5. Surface: a block in `TracingDetailPanel` only for lines that pass the aqueduct test,
   beside `TerrainTracingProfile`, tagged "Calculated"; plus a table page ranking lines by
   gradient with the uncertainty band drawn. Reuse `computeElevationProfile` and its cache;
   bump `PROFILE_MODEL_VERSION` only if sampling changes.

**Measure first.** For the 119 lines ≥ 5 km, run the profile and report how many have
`terrainCoverage` < 0.95 (outside the Mapterhorn extent), how many are "level within the
band" (no usable gradient), and how many pass the title test only. If fewer than ~40 yield a
gradient with a band narrower than the Vitruvius threshold, ship it as a per-record panel
and not as a ranking page.

**Caveats.** A 5 km line at 0.2 % falls 10 m — the same size as the endpoint uncertainty, so
short lines mostly return "undecided", which is the honest answer. Drawn lines are
crowd-traced to tens of metres, and an aqueduct that follows a contour is sensitive to that.
Roman ground ≠ today's ground (reservoirs, quarries). Do not name a figure a
"gradient of the Roman channel"; it is the gradient of the ground the contributor's line
follows. No user data is touched — `gdpr-legal.md` unchanged.

---

## F. Did Rome build on, beside or away from the native strongholds?

**Question.** Atlas of Hillforts of Britain and Ireland × Roman forts: how often is a fort on
or beside a hillfort, are hillforts with Roman-period activity nearer forts than the others,
and do the two kinds of site choose different ground?

**Measured (dev DB, 15 Oct 2026) — this overturned the original framing.**

- **vici's `fort` subcategory is the wrong set of Roman forts in Britain.** It contains the
  hillforts themselves ("Bratton Castle", "Chûn Castle", "Sutton Walls Hill Fort", "Elworthy
  Barrows"): of 667 `fort` sites in the atlas's bounding box, **340 are within 250 m of a
  hillfort (median 201 m)**, an artefact of one record appearing in both sources. Do **not**
  use `sites.subcategory = 'fort'` for this; vici period fields are mostly empty in Britain.
- **Use Pleiades**: `antiquity_places.feature_types` containing `fort-2` or `fortlet` and not
  `hillfort` — **368** places in the British Isles' box (`-11,49,2.5,61`), 356 with a
  `min_year`. (Also in that box: `tower-defensive` 139, `military-installation-or-camp-temporary`
  29 — temporary camps are not predecessor-shaped and are left out.) Pleiades coordinates are a
  place, not a survey; `location_precision` is on the row.
- **Nearest-hillfort distance for those 368:** 4 < 250 m, **9 < 500 m, 24 < 1 km**, 197 < 5 km,
  median **4.7 km**. A crude null (1,000 random land points in the same box) gave median
  5.7 km, 1.1 % < 500 m, 3.7 % < 1 km — so a _slight_ attraction (2.4 % vs 1.1 %), **not
  tested for significance and the null is not conditioned on Roman-occupied ground**, so it
  proves nothing yet. The honest headline so far: _Roman forts are rarely on hillforts._
- **Hillforts with Roman-period dating** (`dated_periods` ∋ `ad50-400`): **192** of 4,147 —
  Scotland 49, England 102, Wales 40, Isle of Man 1, **Ireland 0**. Their median distance to the
  nearest fort is **19.7 km against 21.8 km for the rest**, and only 14 lie within 5 km. So
  Roman-period occupation of a hillfort is _not_ concentrated near forts in this data.
- **18 hillforts lie within 500 m of a fort; 5 of them carry AD 50–400 dating.** That short
  list is the real "reuse or co-location" result and is small enough to publish and read.
- Ireland (507 hillforts) was never garrisoned: a **control group**, not missing data.
- Licence: ADS record, CC BY 4.0 (read from the source and recorded in
  `scripts/import/26-hillforts-atlas.ts`). Pleiades' licence is already handled by its importer (`reference-overlays.md`); it was
  not re-fetched for this plan. Nothing new to fetch.

**Build, in this order (each stops being worth it if the one before is empty).**

1. **The pairs list.** A reading page: every Roman fort/fortlet with a hillfort within a
   named radius (`HILLFORT_NEAR_METRES`, 500) and every hillfort with `ad50-400` dating within
   it, with names, atlas reliability, Pleiades `min_year`/`max_year`, and links to both
   records. SQL, no new geometry code. This alone is publishable.
2. **A null model, done properly** (`shared/utils/spatial-null.ts`, pure and tested):
   sample random points inside a buffer of the forts' own hull (e.g. 30 km of any fort),
   excluding sea (`country_boundaries`), N = 10,000, seeded; report the observed share within
   500 m / 1 km against the null's distribution as a rank (percentile), **not a p-value
   dressed as proof**. Do the same for the 192 Roman-dated hillforts against the other
   hillforts. Precompute with a script like `scripts/sightlines/…`, store the summary in a
   small table or a JSON committed beside the report; do not run it per request.
3. **Terrain fingerprint** (only if E's derivatives exist, else a minimal local version):
   elevation, prominence (elevation minus the mean within 1 km) and slope for forts via
   `loadTerrainField`; for hillforts use the atlas's own `altitude_metres` (4,115 present)
   **and** the model value at the same point, and report the offset — it checks the model
   as well as the sites. Compare distributions; do not claim a mechanism.
4. **Surface:** a "Native stronghold nearby" row in the Pleiades/fort info box (the
   `useSpotFacts` "About this spot" block already carries per-point facts) and the pairs page
   linked from the hillfort overlay's legend. Interface says "recorded within 500 m", never
   "reused", "succeeded" or "conquered".

**Measure first.** The pairs list in step 1 is already counted above; before building 2 and
3, check that the 368 are not duplicated by the same fort under two Pleiades ids (look at
names within 100 m of each other) and read twenty of the 24 within 1 km to confirm they are
real forts and not Pleiades' "hillfort, fort" double-typed places (`feature_types` filter
above excludes the literal `hillfort` type; confirm nothing else slips through).

**Caveats.** The Atlas covers Britain and Ireland only, so this is a _Britain_ result, not a
Roman-world one; do not extend the claim to the continent (the Atlas's continental
equivalents, e.g. oppida, are not imported). Hillfort coordinates are the atlas's centroid
for an enclosure that may be a kilometre across, which blurs a 250 m test — the area
(`area_hectares`, 3,807 rows) should set the tolerance per hillfort, not a flat radius.
"Roman-period dating" in the atlas is evidence of _activity_, not of garrison. A selection
bias runs through all of it: forts were put where the army went, and the atlas's coverage is
uneven between nations.

---

## Lower priority (scope before building)

- **D. Aqueduct gradients.** Scoped above (15 Oct 2026).
- **E. Site-location fingerprints.** Slope, aspect, prominence, distance to
  water/road per category and period; show a site's percentile within its kind;
  test villa-aspect advice (Vitruvius/Columella). vici is a contributed sample —
  state the bias.
- **F. Hillfort → Roman fort.** Scoped above (15 Oct 2026).
- **G. Sailor's view.** ORBIS sea routes × ports × peaks × DEM with curvature and
  a 5 m eye height; landmark sequence along a route; harbour lighthouse reach.
  Heaviest compute — precompute script like the sector sightlines.
- **H. Distance decay beyond the limes.** Hoards/inscriptions binned by km
  inside/outside the frontier per sector. `antiquity_coin_hoards` has name and
  count only, **no date** — location-only unless CHRR is re-imported with
  closing dates.
- **I. Time column for a place.** Extend "About this spot": site periods,
  inscription `not_before`/`not_after`, battle dates, polity per year
  (Cliopatria/OHM). Gaps are the finding.
- **J. Where did the sea go.** Ports × DEM elevation × distance to modern coast;
  ranked list of ports now inland or below present sea level. 276 ports have no
  country (offshore/islands) — surface position accuracy.

## Not worth it yet

- Journey-time isochrones from ORBIS: the importer discarded ORBIS `e`/`s`
  (`15-orbis-routes.ts`, see `antiquity-basemaps.md`); needs a migration,
  re-import and a verified meaning of the figures.
- Quarry-to-inscription supply chains: `inscriptions.material` is free text and
  AWMC material codes are only partly decoded.
