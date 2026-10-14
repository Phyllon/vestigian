# Cross-data features — plan for a fresh session

Written 2026-10-14 after a brainstorm on what the imported datasets can answer
together, in the way the limes tower sightlines do. **Nothing here is built.**
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

D–J below are lower priority; scope against the data before building.

---

## A. Was tower spacing chosen for intervisibility?

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

## C. Conjectured-road plausibility audit

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

## Lower priority (scope before building)

- **D. Aqueduct gradients.** Aqueduct tracings × existing `/api/tracings/:id/profile`;
  mean gradient vs Vitruvius VIII.6 minimum (about 1:200); flag climbs as
  siphon-or-error. DEM noise is comparable to long aqueduct gradients — needs
  smoothing and visible error bars.
- **E. Site-location fingerprints.** Slope, aspect, prominence, distance to
  water/road per category and period; show a site's percentile within its kind;
  test villa-aspect advice (Vitruvius/Columella). vici is a contributed sample —
  state the bias.
- **F. Hillfort → Roman fort.** Atlas of Hillforts × Roman forts: nearest
  predecessor, reuse or avoidance, terrain fingerprints compared.
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
