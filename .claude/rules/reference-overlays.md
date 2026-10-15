---
paths:
  - 'scripts/import/21-itinere-roads.ts'
  - 'scripts/import/22-nomisma-mints.ts'
  - 'scripts/import/23-wikidata-monuments.ts'
  - 'scripts/import/24-isicily-inscriptions.ts'
  - 'scripts/import/25-cliopatria-polities.ts'
  - 'scripts/import/26-hillforts-atlas.ts'
  - 'scripts/import/atlas-cache.ts'
  - 'scripts/import/__test__/reference-sources.test.ts'
  - 'server/utils/reference-layers.ts'
  - 'server/utils/isicily-inscriptions.ts'
  - 'server/api/tiles/reference/**'
  - 'server/api/tiles/antiquity-polities/**'
  - 'server/api/isicily-inscriptions/**'
  - 'shared/utils/reference-overlays.ts'
  - 'app/composables/map/useReferenceOverlays.ts'
  - 'shared/utils/road-audit.ts'
  - 'app/composables/map/usePeriodOverlay.ts'
  - 'app/pages/inscriptions/sicily/**'
  - 'e2e/reference-overlays.spec.ts'
---

## Six more open sources, one shared shape (3–4 Oct 2026)

Itiner-e roads, Nomisma mints, Wikidata monuments, I.Sicily inscriptions,
Cliopatria polities and the Atlas of Hillforts. Each was found by looking for free data that could be
**mirrored** — read once into our own tables, served from our own origin, so a
visitor's browser asks nobody else for anything — and each licence was read from
the source itself, not recalled.

| Source                                                     | Licence (where it was read)                                                                     | In our DB                                                                        | Layer                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Itiner-e (itiner-e.org, Aarhus)                            | CC BY 4.0 — `itiner-e.org/about`; Zenodo's licence field is empty                               | `antiquity_roman_roads`, 14,769 segments, 299,171 km, 19 MB                      | `reference/roman-roads`, 3 certainty lines       |
| Nomisma.org (American Numismatic Society)                  | CC BY 3.0 — front page: "All concepts … openly accessible with a CC-BY license", badge `by/3.0` | `antiquity_mints`, 2,194 mints, 1,425 with a Pleiades link                       | `reference/mints`                                |
| Wikidata (Roman monument classes)                          | CC0 1.0 — `Wikidata:Licensing`                                                                  | `antiquity_monuments`, 3,437 items                                               | `reference/monuments`                            |
| I.Sicily (Oxford / ERC Crossreads)                         | CC BY 4.0 in 5,130 files, **CC BY-NC 4.0 in 6** — `<licence target>` inside every EpiDoc file   | `isicily_inscriptions`, 5,136 records, 5,009 located                             | `reference/isicily` + `/inscriptions/sicily/:id` |
| Cliopatria (Seshat Global History Databank)                | CC BY 4.0 — repository `LICENSE.md` and the Zenodo record (10.5281/zenodo.20274630, v0.2.0)     | `antiquity_polities`, 655 slices of 87 realms                                    | the period scrubber, under the Roman extent      |
| Atlas of Hillforts of Britain and Ireland (Ralston & Lock) | CC BY 4.0 — ADS record 1006508, doi:10.5284/1118744                                             | `antiquity_hillforts`, 4,147 sites, 3,669 confirmed, 192 with AD 50–400 evidence | `reference/hillforts`                            |

Run them with `pnpm import:itinere-roads`, `import:nomisma-mints`,
`import:wikidata-monuments`, `import:isicily-inscriptions`,
`import:cliopatria-polities`, `import:hillforts-atlas` (each takes `-- --dry-run`). All are guarded
(`scripts/import/guard.ts`), cached under `.import/`, and idempotent.

**The road audit is a sixth id, `road-audit`, and the one overlay whose tile holds
two MVT layers** (`audit_segments`, `audit_gaps`) — a calculated reading of Itiner-e
against the atlas's other records rather than a source of its own. See
`.claude/rules/road-audit.md`.

### Architecture, and why it is not four more copies of `useCoinHoardOverlay`

The older overlays (battles, ports, routes, minor features, coin hoards) are one
util + one tile endpoint + one composable each, ~12 touchpoints. The five plain
layers here are the same shape — a table, a GiST index, a handful of properties —
so they share **one** endpoint, `/api/tiles/reference/:layer/:z/:x/:y`
(`server/utils/reference-layers.ts`), **one** list of ids
(`shared/utils/reference-overlays.ts`, read by both the server and the interface),
**one** composable (`useReferenceOverlays.ts`, the layers and popups described as
data, attached by one function) and **one** record of switches in `useBasemapStyle`
(`referenceOverlaysActive`). **To add another layer:** a table + import script, a
case in `buildReferenceTileSql`, an id in `REFERENCE_OVERLAY_IDS`, a definition in
`REFERENCE_OVERLAY_DEFINITIONS`, an attribution constant in `useBasemapStyle.ts`, an
overlay-menu entry in `OverlaySwitcher.vue`, a legend entry, and the strings in all
six locales plus `licence.*`. The neighbouring realms keep their own endpoint,
`/api/tiles/antiquity-polities/:year/...`, because the year is in the path like
`antiquity-empire`.

- **Switch state is not persisted**, like every reference overlay; a basemap swap
  re-attaches through `styledata` (`syncReferenceOverlays` is idempotent).
- **Roads draw one layer per certainty** because `line-dasharray` is not
  data-driven (same constraint as the limes): surveyed solid, conjectured dashed,
  hypothetical dotted, drawn so the evidence lies over the model. Below zoom 6 only
  main roads are served (`ROAD_SECONDARY_MINIMUM_ZOOM`).
- **Neighbours attach with the period overlay** (`usePeriodOverlay`), inserted
  _before_ the Roman fill so Rome draws over what it overlaps. Their switch
  (`isShowingPolities`) sits **in the "Ancient empires" panel under the slider**
  (`PeriodSwitcher.vue`, shown only while a date is chosen), not in the overlay
  menu. Only the label layer takes clicks: the fill covers half the map and would
  fire under every click meant for a marker. Drawn with a fill (0.34), a solid casing
  under a dashed outline and a wide halo, one palette per basemap incl. a night one
  (`resolvePolityColours(view, isDark)`) — raised after "increase contrast a lot".
  The Roman extent is drawn the same way (fill 0.4, casing, outline dashed `[5, 2.5]` —
  longer dashes than the realms' `[3, 2]` so the two never read as one line; its own
  per-basemap palette incl. night) and carries its own name label (`atlas-period-extent-label`, the
  source's `state_name`, uppercase, `text-padding: 40` so a territory crossing a tile
  edge does not carry two) in the tone of its outline.
- **Monuments draw one mark per kind** (`MONUMENT_ICON_GLYPHS` in `useSiteIcons.ts`,
  `MONUMENT_KINDS` in `shared/utils/reference-overlays.ts`). Villa, temple
  (sanctuary), fort, bridge and aqueduct reuse the atlas's glyphs; theatre,
  amphitheatre, bath, forum and mithraeum are new hand-drawn marks (no third-party
  credit). An unknown kind falls back to the generic pedimented front. The key lists
  every kind.
- **Clickable icons answer like sites do.** `openOverlayPopup`
  (`useOverlayPopup.ts`) is the only way an overlay opens a popup: it rings the
  clicked icon (a one-point GeoJSON circle layer, oxide, faint fill) and removes the
  ring when _that_ popup closes — MapLibre closes the old popup on the click that
  opens the new one, so the close handler checks it still owns the ring. Lines and
  areas (roads, routes, realms) pass `withRing: false`. The pointer cursor comes from
  `isOverClickableOverlay` (`useMapInstance.ts`), fed by every layer bound through
  `bindOverlayListenersOnce`: the per-layer `mouseenter` handlers alone were
  overwritten by `MapCanvas`'s `mousemove` on the next pixel.
- **The key explains only what is drawn.** Every `Legend.vue` section is gated on its
  own switch (sites included); with nothing on it shows `legend.emptyHint`.
- **Attribution rides each source** (`ROMAN_ROAD_ATTRIBUTION`, …) and is asserted
  in `e2e/reference-overlays.spec.ts`, both directions. Credits for all five are on
  `/licence` (`licence.overlay*`).
- **No new CSP origin, no new third-party request**: everything is same-origin tiles.

### Facts a reader would otherwise have to rediscover

**Itiner-e's coordinates are EPSG:3395, with a Z on every vertex.** The import reads
the file's own `crs` member, refuses anything else, and reprojects in PostGIS
(`ST_Transform(ST_SetSRID(…, 3395), 4326)`, `ST_Force2D`). Checked, not assumed:
the extent lands at −9.45…41.57 E, 22.69…55.98 N, and `Tingi-Tamuda` starts at
Tangier. The **static Zenodo release (record 17122148) is imported, not the nightly
export**, so a re-import is reproducible. An unfamiliar `Segment_s` value throws
rather than being filed under a default.

**A Wikidata coordinate is not always a coordinate.** The first count said ~6,060
items "with coordinates" for the ten monument classes. 2,563 of the 3,445
Roman-villa rows hold Wikidata's _unknown value_ for P625 — a blank node
(`…/.well-known/genid/…`), not a point — so the count includes them and the parser
discards them. **3,437 items are real**, after a bounding-box guard
(`ROMAN_WORLD_BOUNDS`) dropped three: Portuguese _fórum_ (a courthouse) in Brazil, a
bath in Ethiopia and a cave mithraeum in Iran. The class ids came from
`wbsearchentities`; **exact classes only**, because `P31/P279?` timed out the public
endpoint at 60 s. 2,098 of the 3,440 first-pass items lie within 300 m of an existing
vici site (61 %), so about 1,340 are genuinely new points.

**I.Sicily's `<idno type="filename">` is wrong in four files** (ISic001733, 002094,
020858, 030302 name another record), which broke the unique key on first import. The
id is the **file name**, which is also what I.Sicily's own URLs use. Its `<geo>` is the
modern settlement the stone is attributed to, not a findspot; 194 coordinates fall
outside Sicily's box (Aeolian islands, Malta, museums) and are kept; 127 `<geo>`
values are `...`, a museum note or empty and stay unlocated.

**I.Sicily's photographs are deliberately not mirrored** — and an earlier note in
this session said they could be. Each `<graphic>` is captioned "I.Sicily with the
permission of the Assessorato Regionale dei Beni Culturali e dell'Identità Siciliana
… photo J. Prag": a permission _to the project_, not a licence to anyone downstream,
and Italian cultural-heritage reproduction is regulated apart from copyright. The text
is CC BY 4.0; the photograph's status cannot be read off the TEI's licence element.
The image URLs also answer HTTP 200 with an HTML body (a soft 404). The detail page
links to I.Sicily's own page instead and says so.

**Trismegistos and EDCS ids are shown as plain identifiers, not links.**
`trismegistos.org` answers our client with a bot challenge (403 "Security Check") and a
TLS chain error, and `db.edcs.eu` renders its record client-side, so neither URL pattern
could be verified. EDR's record page was fetched and shows the id, so that one links.

**Cliopatria — measured before it was kept.** For the Roman state itself it adds
nothing: its Roman Empire slices average ~1,300 vertices, OpenHistoricalMap's single
106–114 CE slice has 83,599, and the slice counts are comparable. So the five Roman
entries are excluded and Rome keeps coming from OHM. What it adds is **93 other polities** (87 after dropping six alias entries)
active 509 BCE–476 CE that touch Europe and the Mediterranean — Carthage, the Achaemenid,
Seleucid, Ptolemaic, Parthian and Sasanian empires, Pontus, Numidia, Armenia, the
Nabataeans, Goths, Huns, Vandals, Visigoths — none of which the atlas drew. They are
coarse (50–500 vertices a slice) and the dataset says its maps "reflect only one version
of the territory held by past polities", which the popup repeats. `RELATION` rows
(allegiances) are not territories and are skipped. A multi-polygon realm labels each part,
so "Greek City-States" repeats across the Aegean; accepted rather than hiding a name.

### Does Cliopatria fit the scrubber? Checked at every step (4 Oct 2026)

Both sources were compared at all **51 scrubber steps** (OHM's Roman extent against each
neighbour, areas by `ST_Intersection`, geometries simplified to 0.02°). Findings, and what
was done about each:

- **509–66 BCE: it fits.** Neighbours sit outside Rome; the only overlaps are edge cases
  (Carthage 17–32 % inside the extent in 238–206 BCE, Mamertines 100 % inside at 264 BCE,
  Numidia 48–90 % from 146 BCE). The realms the Republic fought are exactly where the
  period would put them.
- **27 BCE–118 CE: partly redundant.** Four to seven realms are 96–100 % _inside_ OHM's extent
  (Cappadocia, Pontus, Thrace, Galatia, Commagene, Greek City-States): OHM counts client
  kingdoms as Roman while Cliopatria draws them separately until their own annexation. Not a
  contradiction in the history, but the same ground drawn twice with two labels.
- **407–476 CE: a real conflict.** Salian Franks, Visigoths, Burgundians and Vandals are
  100 % inside the Western empire OHM draws, because OHM keeps the whole West Roman until 476
  while Cliopatria gives the foederati their own realms from 407.
- **Aliases.** Six parenthesised entries ("(Macedonian Empire)") duplicate a realm and its
  label (19 slices geometrically identical to their twin). Dropped at import.
- **Gaps.** Still absent: Dacia (nothing around 106 CE), and Cliopatria has 6–7 realms at 114–118
  CE against 20+ in the first century BCE — the Empire at its widest is the sparsest part of the
  map, which is Cliopatria's own coverage, not a filter.

**Decision: the Roman extent wins, at tile time, not at import.** `buildPolityTileSql` cuts
every neighbour by the Roman extent _of the same year_, so a realm shows only the part outside
Rome and one wholly inside it does not appear; the stored outlines stay exactly as Cliopatria
published them, and the popup says the covered ground is not drawn. The scrubber is about the
Roman state, so OHM is its authority; the cost is that the 407–476 foederati disappear from
the West rather than contradicting OHM there. Performance, measured over 1,224 tiles
(51 years × zooms 3/5/7/9 × six tiles around Italy): **0 failures, mean 12 ms, worst 232 ms.**
The first version took up to 8 s on a continental tile because the 83,000-vertex OHM geometry was
validated before it was simplified; simplifying first (all 52 OHM slices are valid already) is
what brought that to 0.2 s.

### The atlas cache counter — what it is, what was wrong, what changed (4 Oct 2026)

**What the counter is.** Every cached atlas tile lives in Valkey under a key that contains a
number: `port:v7:5:17:11` is "the ports layer, generation 7, tile 5/17/11". The number is one
shared counter, `vestigian:atlas-version` (`getAtlasVersion`, `server/utils/cache.ts`; an unset
counter reads as **1**). A reader's request is built from the _current_ number, so changing the
number is how every layer's cache is thrown away at once without deleting anything: the old keys
are still in Valkey, but nothing asks for them any more, and they expire on their own (a drawn
tile after a week, an empty one — most of any pyramid — after thirty days).

**What "reset to 1" meant.** Twelve import scripts ended with `redis.del(counter)` then
`redis.incr(counter)`. `DEL` removes the counter, `INCR` on a missing counter creates it at
**1**. So whatever the generation had reached — 7, 40 — every one of those imports put it back to

1. Two things follow:

1. **The generation went _down_, so old keys came back to life.** Tiles written under an earlier
   visit to generation 1 are still in Valkey until they expire, and `v1` was live again. Shown on
   the dev cache before the fix: the counter stood at 10; running the old coin-hoard import took it
   to 1; and a request for `antiquity-empire/-27/8/137/87` answered `x-atlas-version: 1`,
   `x-tile-cache: hit` from the key `atlas:v1:empire:-27:8:137:87`, written weeks earlier, with 28
   days of life left.
1. **On a fresh or flushed cache it did nothing at all.** An unset counter already reads as 1, and
   `DEL` + `INCR` gives 1, so a first import left the generation exactly where it was — which is
   what the comment in `05-antiquity-atlas.ts` was trying to guard against (it believed clearing
   first would help; it cannot).

The scripts only worked at all because most of them _also_ deleted their own tiles by key pattern
(`KEYS port:v*`). That safety net was missing or wrong in four: **`17-awmc-minor-lines`,
`19-ohm-empire-extents`, `20-attic-inscriptions` purged nothing** (a re-import left the previous
sheet, empire extents or Attic tiles on the map until the tiles expired), and **`13-battles`
purged `atlas:v*battle*`, a pattern that matches nothing** — battle tiles are `battle:v*`.

**The fix.** All twelve now call `refreshAtlasCache` (`scripts/import/atlas-cache.ts`): it moves
the counter **up** — `INCR`, or `INCRBY 2` when it is unset, so the first bump lands on 2 and not
on the 1 an unset counter already means — and removes the layer's own keys with `SCAN` +
`UNLINK` (never the blocking `KEYS`). Patterns, per script: `05` `atlas:v*`; `06`
`atlas:v*` + `limes:v*`; `12` `inscription:v*`; `13-battles` `battle:v*` (the corrected one);
`13-edh-inscription-images` none (no tile reads it); `14` `port:v*`; `15` `route:v*`; `16`
`feature:v*`; `17` `atlas:v*`; `18` `coin-hoard:v*`; `19` `atlas:v*:empire:*`; `20`
`attic-inscription:v*`; `21`–`26` `reference:<layer>:*`. The counter is now monotonic, so a
generation can never be reused.

**Re-run to prove nothing broke (4 Oct 2026).** All twelve older scripts were run again against
their cached input on the dev database, in dependency order. Every one exited 0, the counter
rose by exactly one per script (1 → 13), and a before/after fingerprint of the 16 tables they
write — row count plus an `md5` of the ordered geometry text and a vertex total — was
**identical for every table** (79,201 inscriptions, 29,457 Pleiades places, 52 empire extents, …).
The helper itself was checked separately against the live Valkey: an unset counter lands on 2
rather than 1, an existing 40 becomes 41, a pattern removes only its own keys (a neighbouring
layer's key survived), and an unreachable Valkey prints a warning and exits 0. Battle tiles, whose
old purge pattern matched nothing, are now actually dropped (84 in the dev cache).

**A code-only change to a tile's SQL still needs a bump** — the counter is not derived from the
query. After deploying such a change, `INCRBY 2 vestigian:atlas-version` — **not** `INCR`, which on an unset counter creates it at 1, the value an unset counter already reads as (runbook §15b step 4). Hit for real on the first release: bare `INCR` left `x-atlas-version: 1`, and empty tiles cached before the data arrived were still served at zoom 5 and below.

### Candidates investigated and _not_ built (3–4 Oct 2026)

| Source                                                                                                      | Licence found                                                                                                                                                                                                                  | Reachable / mirrorable                                                                                                                                                                                                         | Verdict                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Portable Antiquities Scheme** (finds.org.uk)                                                              | Site terms **CC BY 3.0**, attribution "The Portable Antiquities Scheme / The Trustees of the British Museum" (Wayback copy, 3 Dec 2025; the page also says "Creative Commons Share-Alike", which CC BY 3.0 is not — ambiguous) | `finds.org.uk` answers **403 to every request** from this host, including with a browser User-Agent. ~360,000 public records via OAI-PMH (`/datalabs/oai/request`, per the Wayback copy). Find-spot publishing rules not read. | **Do not build yet.** Licence is readable but access is blocked; the data's find-spot precision rules and bulk-harvest permission need asking. `import-pipeline.md` already records the bot challenge.                               |
| **Trismegistos**                                                                                            | A web search summary says CC BY-SA 4.0 for the data and open table dumps/APIs (DARIAH-BE). **Not confirmed from the source**: `trismegistos.org` fails TLS verification and bot-challenges our client.                         | Geo table dump advertised at `/dataservices/tabledump/` — unreachable here.                                                                                                                                                    | **Unverified.** Verify from a normal browser first; do not rely on the search summary.                                                                                                                                               |
| **OpenStreetMap `historic=archaeological_site`**                                                            | ODbL 1.0 (Overpass reply carries the notice). Needs its own tables, like AWMC.                                                                                                                                                 | Overpass counts: **21,171** in 30–46 °N / 12 °W–10 °E and **19,034** in 30–46 °N / 10–45 °E; the northern halves timed out. Mirrorable from a Geofabrik extract.                                                               | **Usable, mixed value.** Sample 6–8 °E, 50–52 °N: 1,889 features vs our 430 sites; only 170 within 300 m of one of ours; 158 mention "Roman", none carry `period`/`site_type`. Mostly prehistoric barrows and unlabelled earthworks. |
| **Oxford Roman Economy Project** databases (shipwrecks, mines, quarries, presses, cities, water technology) | **None stated** on the pages ("Content: OXREP, 2005–2026").                                                                                                                                                                    | Pages reachable.                                                                                                                                                                                                               | **Not usable without permission.** Open TODO in the runbook (§19).                                                                                                                                                                   |
| **EDH photographs**                                                                                         | **Rights reserved** — all 43,199 records carry Europeana `rr-f`; 2,000 local files re-checked 3 Oct 2026, none different.                                                                                                      | Metadata only.                                                                                                                                                                                                                 | **Not usable without EDH's permission.** Open TODO in the runbook (§19).                                                                                                                                                             |
| **Pleiades**                                                                                                | CC BY 3.0                                                                                                                                                                                                                      | Already imported (29,457 places); Pleiades also publishes RDF dumps.                                                                                                                                                           | Done — and relevant if an RDF export is ever wanted.                                                                                                                                                                                 |

### Ancient Sites and Monuments Survey — evaluated, then two slices built (15 Oct 2026)

`.import/ancient-monuments-survey-2026-09-30.csv`: 1,313,286 points, 228 countries, 695 MB, **ODbL 1.0**
(share-alike) over some 190 sources whose own licences are listed in the file's `#` header line. Columns:
`survey_id, wikidata_id, name, category, type_in_source, country, lat, lon, note, sources, register_id,
osm_id` — **no period column**; dating lives only in `note` free text (vici `(city; 1200 BC to later)`,
Sardinian `Età Romano imperiale`, Cornwall `Early Iron Age to Romano British`, Canmore `(ROMAN)`).
Header says IPHAN and Portugal are "terms to confirm"; ~1 km-rounded locations are marked in `note`.

It is overwhelmingly prehistoric northern Europe (barrows, cairns, stone settings: Sweden, UK, Ireland,
Denmark). Matched against `sites` + `external_ids` + the `antiquity_*` tables + the local Pleiades CSV
(id match, then ≤150 m with a name token in common): **95.3 % is farther than 500 m from anything we
hold**, 0.7 % an id duplicate. Atlas of Hillforts rows are 96 % duplicates of `antiquity_hillforts` — skip.
Vici.org rows are 67 % id duplicates; the ~1,000 unmatched were not in the 2026 dump (not investigated).
Pleiades links in it (546) are all already ours.

A tiered review set (11,472 rows, `.import/review/antiquity-review-set.csv`, gitignored) was cut from the
unmatched rows: T1 classical core 1,064 (tombs, necropolis, building remains in Roman-world countries,
anchored by Wikidata/vici/Fasti or classical wording — **noisy**: it still holds prehistoric hypogea and
medieval chapels), T2 classical wording 3,551 (mostly Villages to Empires, Levant), T3 Cornwall HER
"Romano British" enclosures 2,065, T4 Fasti Online excavation records 3,931 (finds list only, no period),
T5 nuraghi/brochs/taulas 822 (scope decision), T6 pre-classical/Pharaonic 39. Two slices of it were then
built — see "Dated survey sites" below; nothing else from the file is imported.

If a source from it is ever wanted, take it **by source, not by file**: Fasti Online (CC BY-SA 4.0), the
Villages to Empires South Levant set (CC BY 4.0), or Sardinia PPR (CC BY 4.0, "selected and converted")
each have their own licence and can be checked against their upstream, as every other importer here is.
Importing the combined file would put an ODbL layer, with its share-alike, into a database whose other
layers are CC0/CC BY — a licence decision for the maintainer, not a default.

What the four slices actually are (measured 15 Oct 2026, same run):

- **UNESCO** — 949 unmatched rows with a `World Heritage property N` note are 66 % Spanish prehistoric
  cave art (property 874, 627 rows), then Swiss pile dwellings; only ~10 are `ancient city`. The usable
  value is the property number on the 145 rows that _do_ match a site we hold, not the new points.
- **Fasti** — rows are excavation _plots_ ("Athens 2011"), not monuments; 2,152 of 4,335 record zero
  seasons, none carry a period, 4,229 carry a deep link to a season report on fastionline.org.
- **Roman-text** — 6,009 unmatched rows: Villages to Empires 2,269 (Levant surveys, multi-period),
  Cornwall HER 2,072, Kwok & Peters 773 (bibliographic).
- **Cornwall** — 1,756 of 2,065 are `round (enclosed settlement)`, which the survey files under
  "Hillfort"; **71 % are "destroyed or known from records"** (levelled cropmarks) and 70 % "uncertain".
  We hold 100 sites in the whole Cornwall bbox today.

### Dated survey sites — `survey-sites`, built (15 Oct 2026)

`pnpm import:survey-sites` → `antiquity_survey_sites`, **4,671 rows**; overlay `survey-sites` ("Dated survey
sites"). The reader is `shared/utils/survey-sites.ts` (tested): one small grammar per upstream source,
because the survey has no period column and a regex over every note matched bibliography titles
("Journal of Roman Archaeology"), a surname ("Francisco Romano") and Baltic "Pre-Roman Iron Age".

| Source (as the survey's `note` names it) |  Rows | Licence — fetched, 15 Oct 2026         | Period read from                                                                                                                                                                               |
| ---------------------------------------- | ----: | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Villages to Empires, South Levant        | 2,190 | CC BY 4.0, Zenodo 17285091             | `; periods A; B; Roman-Byzantine (…);` against the dataset's own `Period`→`StartDate`/`EndDate`                                                                                                |
| Cornwall & Scilly HER                    | 2,060 | OGL v3, data.gov.uk (Cornwall Council) | last clause, e.g. `Early Iron Age to Romano British`, against Historic England's period vocabulary (`purl.org/heritagedata/schemes/eh_period`, OGL v3: Roman 43–410, Early Iron Age −800…−300) |
| Gwiazda, Syro-Palestinian chamber tombs  |   200 | CC BY 4.0, Zenodo 4156221              | explicit years: `BCE 63-700 CE`, `100–1 BCE`, several per shared point                                                                                                                         |
| Marmarica (Laguna-Palma)                 |    12 | CC BY 4.0, Zenodo 7678852              | period names; **numbers are a convention** (`period_basis = 'convention'`)                                                                                                                     |

- **Window −800…640.** Periods are clipped to it: "Palaeolithic to Romano British" is stored from −800.
  Levant rows keep only Hellenistic→Byzantine atoms (Persian and earlier are not antiquity here);
  Britain's Iron Age counts because it is the contemporary of Hellenistic/Roman Europe.
- **Left out, counted by the run:** vici.org rows (12,891); spot-height labels such as `Elevation Point 577`
  (91 — the `[n]` running index in a name is stripped). **Checked against the Survey's own credits page
  (survey.jensineandresen.com, 15 Oct 2026) and still out:** Kwok & Peters (CC0, but "Roman" only in
  bibliography titles), Latvia (CC0, but every dating is "Pre-Roman Iron Age"), the Italian GNA (**no licence
  stated**), IPHAN (terms "being confirmed"), Portugal (CC BY-NC and absent from the Survey's own download),
  OSM limes points (own layer). Luwian Studies **was** missing from the CSV's `#` header but the credits page
  states CC BY 4.0, and Zenodo 17128262 agrees — so it is in.
  Canmore and Historic England answer 403 to a script (as the PAS does); their OGL rests on the Survey's page.
  Cornwall's Iron-Age-only and prehistoric records are also out: the ask was Romano-British.
- **One mark per kind, from glyphs the atlas already has** (`SURVEY_SITE_KIND_GLYPHS`, `useSiteIcons.ts`):
  settlement → the village; hut circle → the enclosure ring (the same Cornish settlement pattern at a
  smaller scale; one image id, `surveySiteIconId`); courtyard house and building → the villa's gabled front;
  fortification → the castle; hillfort → the hillfort hill; burial → the pyramid; harbour → the port anchor;
  fogou and unclassified site → the generic standing stone; **enclosed settlement keeps the ring** it was
  first drawn with. The popup and key name each kind (`referencePopup.surveySite.kind.*`), so shared marks
  stay distinguishable by text. Names show from zoom 12: the HER titles are long ("CHYTODDEN - Iron Age
  round, Romano British") and collide below it. Seen in a headless browser at Cornwall and the Levant
  (rings, villages, a castle); the intro tour covered both shots, so the key panel itself was **not** viewed.
- **Destroyed and uncertain are kept** (Cornwall: 1,483 destroyed / "known from records", 1,468 uncertain,
  of 2,060). The tile carries `destroyed`, `uncertain`, `evidence` (cropmarks / documents / place names /
  demolished structure); the layer fades a destroyed record to 0.45 and the popup says why. A levelled
  round is still evidence that the place was settled.
- **Deduplicated against the atlas at import time**: anything within 500 m of `sites`, `antiquity_places`,
  `_hillforts`, `_monuments`, `_ports`, `_battles` or `_mints` is removed after loading (449 + 121 + … on
  the first run), so re-running against a bigger atlas shrinks the table instead of doubling a pin.
- **Not in `sites`** and not editable: a read-only reference layer like the hillforts. The numeric ids are
  reassigned on every re-import; `survey_id` (the survey's `MS-…`) is the stable key.
- **Attribution** names the Survey with its author and links the name, as its credit asks:
  "[Ancient Sites and Monuments Survey](https://survey.jensineandresen.com) (Jensine Andresen)" — in the map
  credit (`SURVEY_SITE_ATTRIBUTION`), the popup, and `/licence`. The address given was a Google redirect
  wrapper; its target, `survey.jensineandresen.com`, is what is linked (answers 200 over https).
  The Survey also says: credit the sources, and **share any adapted database under the same licence** (ODbL).
- **Also exported, apart, and searchable.** `/api/odbl/survey-sites.{geojson,ttl}` (see `open-data-feeds.md`
  for why it is not in the CC BY-SA / CC0 feeds); the names are found by the map search bar
  (`REFERENCE_SEARCH_SOURCES`, `0037_survey_sites_search.sql`, reveal switches the layer on). The
  sitemap needs nothing — there is no page per site.
- **A partner.** The Survey is the first real entry on `/partners` (`PARTNERS`, kind `database`, "Stone,
  timber, and earth." in its words, no mark supplied). See `partners.md` for what that page promises.
- **No "About this spot" block** (`spotSourceId` unset): `REFERENCE_SOURCES` holds one source per layer
  and this layer has four; the popup carries its own source line and dataset link instead.
- **ODbL.** The survey file is share-alike; what is stored is four upstream rows' fields as the survey
  passes them on, each under its own checked licence. The combined layer is offered under ODbL as the
  Survey asks (and §4.6 requires): `/api/odbl/survey-sites.*`, one of eight such feeds — see
  `open-data-feeds.md`.
- **Not seen in a browser.** Tiles verified over HTTP (Levant z7 64 KB, Cornwall z7 150 KB, both `200`);
  the layer, popup and key were typechecked and linted but not looked at. `e2e/reference-overlays.spec.ts`
  lists the layer (written, not run). Cornwall z7 at 150 KB is the heaviest tile of any reference layer —
  worth measuring at z5–6 before anything is built on it.

- **"Missing at low zoom, present when zoomed in" is a stale tile, not missing data** (reported 15 Oct 2026
  after several re-imports). A tile URL carries no data generation and the route answers `max-age=86400,
stale-while-revalidate=604800`, so a browser keeps tiles it fetched _before_ a later import: the
  report listed exactly the first import's sources (Cornwall, the Levant, Egypt) at zoom 4 and the
  later ones (Scotland, northern England, Anatolia, Sardinia) only at zooms never visited before.
  Checked: every zoom-2 tile pair holds all 4,671 rows, the zoom 4 tiles over Scotland, northern
  England, Sardinia and Anatolia hold their rows, and a fresh browser draws them at zoom 4. **Under
  `nuxt dev` every tile route now sends `no-cache`** (`server/utils/tile-cache-control.ts`:
  `atlasTileCacheControl()` for the atlas, reference and overlay routes and the basemap,
  `siteTileCacheControl()` for the contributed site and tracing tiles via `site-tile.ts`); production
  keeps the one-day and one-hour lifetimes, so after a production import purge the pull zone as the
  runbook's "A layer is missing at some zooms only" describes. A new tile route takes the helper, not
  a literal.
