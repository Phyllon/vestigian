import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { pointGeometry, siteCategoryEnum } from './sites'

/**
 * The antiquity atlas: third-party reference cartography behind the
 * 'antiquity-awmc' basemap — AWMC's Barrington-derived geodata (ODbL 1.0) and
 * Pleiades places (CC BY 3.0).
 *
 * Deliberately unrelated to `sites` and `tracings`, with no foreign key in
 * either direction. ODbL's share-alike attaches to a derivative *database*, so
 * mixing these rows into the tables behind the public GeoJSON feed would pull
 * that feed under ODbL and contradict the licence the contributed data carries.
 * Rendered tiles are a Produced Work and need only attribution. See the comment
 * at the top of `0003_antiquity_atlas.sql`.
 */
const multiLineGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiLineString, 4326)',
})

const multiPolygonGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
})

const lineGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(LineString, 4326)',
})

const polygonGeometry = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Polygon, 4326)',
})

export const antiquityLineKindEnum = pgEnum('antiquity_line_kind', [
  'road',
  'aqueduct',
  'canal',
  'wall',
  'shoreline',
  /** Roman field-division grids, AWMC's own `centuriation` shapefile layer
   *  — see `.claude/rules/antiquity-basemaps.md`. */
  'centuriation',
  /** Both from the same shapefile release — geometrically lines, not the
   *  points their layer names might suggest, confirmed by reading the
   *  actual `.shp` geometry type rather than assumed from the DBF alone. */
  'causeway',
  'dike_levee',
])

export const antiquityWaterKindEnum = pgEnum('antiquity_water_kind', ['sea', 'inland'])

export const antiquityWater = pgTable(
  'antiquity_water',
  {
    id: serial('id').primaryKey(),
    kind: antiquityWaterKindEnum('kind').notNull(),
    name: varchar('name', { length: 240 }),
    geom: multiPolygonGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_water_geom_idx').using('gist', table.geom)],
)

export const antiquityLines = pgTable(
  'antiquity_lines',
  {
    id: serial('id').primaryKey(),
    kind: antiquityLineKindEnum('kind').notNull(),
    name: varchar('name', { length: 240 }),
    /** Barrington's major route versus track, and course established versus inferred. */
    major: boolean('major').notNull().default(false),
    certain: boolean('certain').notNull().default(true),
    period: varchar('period', { length: 16 }),
    geom: multiLineGeometry('geom').notNull(),
  },
  (table) => [
    index('antiquity_lines_geom_idx').using('gist', table.geom),
    index('antiquity_lines_kind_idx').on(table.kind),
  ],
)

export const antiquityAreas = pgTable(
  'antiquity_areas',
  {
    id: serial('id').primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull(),
    name: varchar('name', { length: 240 }),
    pleiadesId: varchar('pleiades_id', { length: 32 }),
    geom: multiPolygonGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_areas_geom_idx').using('gist', table.geom)],
)

export const antiquityRegions = pgTable(
  'antiquity_regions',
  {
    id: serial('id').primaryKey(),
    title: varchar('title', { length: 240 }).notNull(),
    kind: varchar('kind', { length: 64 }),
    pleiadesId: varchar('pleiades_id', { length: 32 }),
    minYear: integer('min_year'),
    maxYear: integer('max_year'),
    geom: multiLineGeometry('geom').notNull(),
    /** Derived once at import; AWMC publishes extents as linework, not fills. */
    labelGeom: pointGeometry('label_geom').notNull(),
  },
  (table) => [
    index('antiquity_regions_geom_idx').using('gist', table.geom),
    index('antiquity_regions_label_idx').using('gist', table.labelGeom),
  ],
)

export const antiquityPlaces = pgTable(
  'antiquity_places',
  {
    id: serial('id').primaryKey(),
    pleiadesId: varchar('pleiades_id', { length: 32 }).notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    featureTypes: varchar('feature_types', { length: 240 }),
    minYear: integer('min_year'),
    maxYear: integer('max_year'),
    locationPrecision: varchar('location_precision', { length: 24 }),
    /**
     * Pleiades' free-text feature types, collapsed at import into the marks
     * this map already draws. Null where the record is a landscape feature
     * rather than a place: a name on the sheet, and no symbol.
     */
    category: siteCategoryEnum('category'),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    uniqueIndex('antiquity_places_pleiades_idx').on(table.pleiadesId),
    index('antiquity_places_geom_idx').using('gist', table.geom),
    index('antiquity_places_category_idx').on(table.category),
  ],
)

/**
 * The Roman state's territorial extent as a continuous dated series — the
 * period scrubber on the Barrington sheet. One row per time slice, each an
 * interval (`start_year` inclusive, `end_year` exclusive) rather than a
 * snapshot year, because that is how the source models it.
 *
 * **Source: OpenHistoricalMap, CC0 1.0** — confirmed against OHM's own
 * `/copyright` page ("Except where otherwise noted, OpenHistoricalMap data
 * is dedicated to the public domain under a Creative Commons CC0
 * dedication"), and against the relations themselves: of the 87 Roman-state
 * boundary relations, exactly two carry an explicit `license=*` tag and both
 * say `CC0-1.0`. None carries CC BY or CC BY-SA, so the share-alike carve-out
 * that page warns about does not apply to anything imported here.
 *
 * This is the one borrowed dataset in this file that is **not** ODbL, which
 * is why it is its own table rather than more rows in a shared one. Nothing
 * is lost by isolating it and a great deal is risked by mixing licences in a
 * table, as the note at the top of this file explains for the opposite case.
 *
 * **It supersedes AWMC's `political_shading/` extents, which gave three
 * dates.** This gives 52 inside the project's antiquity cutoff, is CC0
 * rather than ODbL, and carries an `end_event` naming the conquest or loss
 * that closes each slice. The trade-off is honest and worth stating: AWMC's
 * three were drawn by academic cartographers, while these are drawn by OHM's
 * contributors, some of whom openly tag their own boundary lines as still
 * needing a source. This is an approximation of the frontier, and the
 * interface says so rather than implying survey precision.
 *
 * Years are stored exactly as OHM writes them: a negative year is a
 * traditional BCE count, so -509 is 509 BCE. Unlike Wikidata (see
 * `13-battles.ts`, where -215 means 216 BCE) there is no astronomical
 * off-by-one to undo — verified against slices whose dates are unambiguous
 * in the historical record (264..-241 the First Punic War, -146 the fall of
 * Carthage, -27 Augustus).
 */
export const antiquityEmpireExtents = pgTable(
  'antiquity_empire_extents',
  {
    id: serial('id').primaryKey(),
    /** The OHM relation this slice came from — the row's identity upstream. */
    ohmRelationId: integer('ohm_relation_id').notNull(),
    /** `Res Publica Romana`, `Imperium Romanum`, `... Occidentale`, `... Orientale`. */
    stateName: varchar('state_name', { length: 120 }).notNull(),
    startYear: integer('start_year').notNull(),
    endYear: integer('end_year').notNull(),
    /** OHM's own narrative for what ends the slice ("Trajan conquers
     *  Armenia"). English only upstream — see the note in `useEmpirePeriods`. */
    endEvent: text('end_event'),
    geom: multiPolygonGeometry('geom').notNull(),
  },
  (table) => [
    index('antiquity_empire_extents_geom_idx').using('gist', table.geom),
    index('antiquity_empire_extents_start_idx').on(table.startYear),
    uniqueIndex('antiquity_empire_extents_relation_idx').on(table.ohmRelationId),
  ],
)

/**
 * Ancient battles, worldwide — not scoped to Rome. Wikidata (CC0), not
 * Pleiades: a live query found Pleiades' own "battlefield" place-type used
 * by zero rows in the full gazetteer this file already imports, since
 * Pleiades catalogues continuously-occupied places, not one-off
 * engagements. One row per Wikidata item with a coordinate and a
 * point-in-time date before year 500 (the conventional end of antiquity) —
 * see `.claude/rules/antiquity-basemaps.md` for the exact query and the
 * verified counts. `year` is a single point, never a range: every row
 * comes from Wikidata's P585 (point in time), not a start/end pair.
 */
export const antiquityBattles = pgTable(
  'antiquity_battles',
  {
    id: serial('id').primaryKey(),
    wikidataId: varchar('wikidata_id', { length: 16 }).notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    /** BCE negative, matching antiquity_places.min_year/max_year. */
    year: integer('year').notNull(),
    /** Collapsed from Wikidata's geoPrecision the same two-value way
     *  `isLocatedPrecisely` already reads Pleiades' own vocabulary. */
    locationPrecision: varchar('location_precision', { length: 24 }).notNull(),
    wikipediaUrl: varchar('wikipedia_url', { length: 500 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    uniqueIndex('antiquity_battles_wikidata_idx').on(table.wikidataId),
    index('antiquity_battles_geom_idx').using('gist', table.geom),
  ],
)

/**
 * Ancient ports and harbours worldwide, from Arthur de Graauw's Catalogue
 * of Ancient Ports (CC BY 4.0, ancientportsantiques.com), also deposited as
 * the DARMC Scholarly Data Series (Harvard) — both credits travel together,
 * see `.claude/rules/antiquity-basemaps.md`. `sourceRowId` is the
 * workbook's own `NB` column, kept as text since it is sometimes fractional
 * (Excel's own sub-numbering, e.g. "1.1"). `foundation` is free text, not a
 * year: the source mixes single years, BCE ranges and blanks, and parsing
 * it into a number would silently misrepresent entries that are ranges.
 */
export const antiquityPorts = pgTable(
  'antiquity_ports',
  {
    id: serial('id').primaryKey(),
    sourceRowId: varchar('source_row_id', { length: 20 }).notNull(),
    /** `text`, not `varchar`: when the source has no ancient name, this
     *  falls back to NAME_MOD's free-text description, up to 664 characters
     *  in the actual workbook — a length limit would truncate real content. */
    title: text('title').notNull(),
    /** Only set when the source's NAME_MOD is a real modern name distinct
     *  from the title, not the free-text description that fills its place
     *  when the ancient name (NAME) is blank. */
    modernName: text('modern_name'),
    country: varchar('country', { length: 150 }),
    foundation: varchar('foundation', { length: 200 }),
    pleiadesUrl: varchar('pleiades_url', { length: 500 }),
    wikipediaUrl: varchar('wikipedia_url', { length: 500 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    uniqueIndex('antiquity_ports_source_row_idx').on(table.sourceRowId),
    index('antiquity_ports_geom_idx').using('gist', table.geom),
  ],
)

/**
 * The Roman-era transport network from ORBIS v2 (Meeks, Scheidel, Weiland,
 * Arcenas, Stanford, 2014), CC BY 3.0 per the Stanford Digital Repository
 * deposit — not the MIT licence on the GitHub mirror, which covers only
 * Elijah Meeks's D3.js viewer, not the data it also carries. One row per
 * `base_routes.geojson` edge; `sourceTitle`/`targetTitle` are looked up
 * from `sites_extended.csv` at import time and left null when a node id
 * isn't found there, rather than dropping the route.
 */
export const antiquityRouteKindEnum = pgEnum('antiquity_route_kind', [
  'road',
  'coastal',
  'overseas',
  'upstream',
  'downstream',
  'ferry',
])

export const antiquityRoutes = pgTable(
  'antiquity_routes',
  {
    id: serial('id').primaryKey(),
    sourceNodeId: integer('source_node_id').notNull(),
    targetNodeId: integer('target_node_id').notNull(),
    sourceTitle: varchar('source_title', { length: 200 }),
    targetTitle: varchar('target_title', { length: 200 }),
    routeType: antiquityRouteKindEnum('route_type').notNull(),
    geom: lineGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_routes_geom_idx').using('gist', table.geom)],
)

/**
 * The small AWMC point layers that ship only in its "Cultural Shapefiles"
 * release, never as GeoJSON: bridges, mines/quarries, dams, cemeteries,
 * Barrington's own scattered forts (not the limes frontier's contributed
 * fortifications — a different, much sparser layer, ten points worldwide)
 * and tumuli. Unified into one table rather than six — the combined count
 * is ~525 rows, and every one of these layers shares the same shape (a
 * point, a name that is often blank, a source citation). Same ODbL 1.0 as
 * every other AWMC table in this file, per the repo's own root
 * `LICENSE.txt` (the README's "GeoJSONs are more up-to-date" caveat is
 * about freshness, not licensing — see `.claude/rules/antiquity-basemaps.md`).
 *
 * Two more layers in the same shapefile release — `causeways` and
 * `dikes_levees` — are named like points but are geometrically lines,
 * confirmed by reading their actual `.shp` geometry type rather than
 * assumed from the layer name; they live in `antiquity_lines` instead,
 * alongside centuriation.
 */
export const antiquityFeatureKindEnum = pgEnum('antiquity_feature_kind', [
  'bridge',
  'mine_quarry',
  'dam',
  'cemetery',
  'fort',
  'tumulus',
])

export const antiquityFeatures = pgTable(
  'antiquity_features',
  {
    id: serial('id').primaryKey(),
    kind: antiquityFeatureKindEnum('kind').notNull(),
    name: varchar('name', { length: 240 }),
    /** Barrington Atlas map-sheet reference, e.g. "BAtlas_22" — most rows carry one, few carry a name. */
    source: varchar('source', { length: 100 }),
    /** Only meaningful for `mine_quarry`: chemical-symbol shorthand as the source gives it (e.g. "Fe", "Au, Ag"). */
    material: varchar('material', { length: 100 }),
    /** Only meaningful for `bridge`: which of the shapefile's five period-attestation flags were set, joined as "Roman, Late". */
    periods: varchar('periods', { length: 100 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    index('antiquity_features_geom_idx').using('gist', table.geom),
    index('antiquity_features_kind_idx').on(table.kind),
  ],
)

/**
 * Coin-hoard findspots from Coin Hoards of the Roman Republic (CHRR,
 * numismatics.org/chrr). Licence is genuinely mixed between the site's own
 * pages (ODbL 1.0) and its machine-readable VoID descriptors (CC BY-NC 3.0,
 * copyright Kris Lockyear) — the stricter, machine-declared one is treated
 * as authoritative here; NC is within this project's own stated policy.
 * One row per findspot, not per hoard: `findspots.geojson` aggregates
 * CHRR's 694 hoard records to 620 distinct locations with a hoard count
 * each, and that aggregate is what this table holds — not a fabricated
 * per-hoard breakdown this source doesn't cleanly publish in bulk.
 */
export const antiquityCoinHoards = pgTable(
  'antiquity_coin_hoards',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 240 }).notNull(),
    hoardCount: integer('hoard_count').notNull(),
    geonamesUrl: varchar('geonames_url', { length: 300 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_coin_hoards_geom_idx').using('gist', table.geom)],
)

/**
 * Itiner-e — the digital atlas of ancient roads (Brughmans, Pažout, de Soto
 * and Bjerregaard Vahlstrup; CC BY 4.0, itiner-e.org). A far denser network
 * than the Barrington roads in `antiquity_lines`: 14,769 segments, ~299,000
 * km. Its own table because the two are different scholarship with different
 * licences, and because this one carries per-segment certainty the Barrington
 * layer cannot express. `certainty` is Itiner-e's own `Segment_s` vocabulary,
 * `main` its `Route_Type` 2 versus 1.
 */
export const antiquityRoadCertaintyEnum = pgEnum('antiquity_road_certainty', [
  'certain',
  'conjectured',
  'hypothetical',
])

export const antiquityRomanRoads = pgTable(
  'antiquity_roman_roads',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 240 }),
    /** Itiner-e's `Route_Type` 2 ("Main Road") versus 1 ("Secondary Road"). */
    isMain: boolean('is_main').notNull().default(false),
    certainty: antiquityRoadCertaintyEnum('certainty').notNull(),
    /** The itinerary that attests the segment ("Itinerarium Antonini"), when one does. */
    itinerary: varchar('itinerary', { length: 160 }),
    /** Who traced it, and the printed source ("BAtlas 28, Lenoir 1993"). */
    citation: varchar('citation', { length: 300 }),
    bibliography: varchar('bibliography', { length: 400 }),
    geom: multiLineGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_roman_roads_geom_idx').using('gist', table.geom)],
)

/**
 * Mints from Nomisma.org (CC BY 3.0) — 2,194 places with a coordinate, 1,425
 * of them linked to a Pleiades place. `nomismaId` is the trailing segment of
 * the concept URI (`http://nomisma.org/id/Paktye` → `Paktye`), the natural key.
 */
export const antiquityMints = pgTable(
  'antiquity_mints',
  {
    id: serial('id').primaryKey(),
    nomismaId: varchar('nomisma_id', { length: 120 }).notNull().unique(),
    name: varchar('name', { length: 240 }).notNull(),
    pleiadesId: varchar('pleiades_id', { length: 24 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_mints_geom_idx').using('gist', table.geom)],
)

/**
 * Roman-period monuments from Wikidata (CC0 1.0): one row per item with a
 * coordinate whose `instance of` is exactly one of these classes. Direct
 * `P31` only — walking `P279*` subclasses times the public endpoint out, and
 * the exact-class set is already ~6,000 items.
 */
export const antiquityMonumentKindEnum = pgEnum('antiquity_monument_kind', [
  'theatre',
  'amphitheatre',
  'villa',
  'aqueduct',
  'bridge',
  'temple',
  'fort',
  'bath',
  'forum',
  'mithraeum',
])

export const antiquityMonuments = pgTable(
  'antiquity_monuments',
  {
    id: serial('id').primaryKey(),
    wikidataId: varchar('wikidata_id', { length: 24 }).notNull().unique(),
    name: varchar('name', { length: 240 }).notNull(),
    kind: antiquityMonumentKindEnum('kind').notNull(),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    index('antiquity_monuments_geom_idx').using('gist', table.geom),
    index('antiquity_monuments_kind_idx').on(table.kind),
  ],
)

/**
 * The neighbours of the Roman state — Carthage, Parthia, the Seleucid and
 * Ptolemaic kingdoms, Pontus, the Goths and Vandals — as dated boundary slices
 * from Cliopatria (Seshat Global History Databank, CC BY 4.0). Only
 * `POLITY` rows that are not Roman and that touch Europe and the
 * Mediterranean between 509 BCE and 476 CE: the Roman state itself comes from
 * `antiquity_empire_extents` (OpenHistoricalMap), which is some fifty times
 * more detailed. Years follow Cliopatria's own convention, negative for BCE.
 * The boundaries are schematic, one scholarly version of a territory.
 */
export const antiquityPolities = pgTable(
  'antiquity_polities',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    fromYear: integer('from_year').notNull(),
    toYear: integer('to_year').notNull(),
    wikidataId: varchar('wikidata_id', { length: 24 }),
    /** Cliopatria's Wikipedia page phrase ("History of Sumer"), not a URL. */
    wikipediaTitle: varchar('wikipedia_title', { length: 240 }),
    areaSquareKilometres: integer('area_square_kilometres'),
    geom: multiPolygonGeometry('geom').notNull(),
  },
  (table) => [
    index('antiquity_polities_geom_idx').using('gist', table.geom),
    index('antiquity_polities_years_idx').on(table.fromYear, table.toYear),
  ],
)

/**
 * The Atlas of Hillforts of Britain and Ireland (Ralston & Lock; Oxford, Edinburgh and
 * University College Cork; CC BY 4.0, Archaeology Data Service doi:10.5284/1118744):
 * 4,147 enclosed hilltop and promontory sites. Mostly Iron Age, but the atlas itself says
 * it is "not an Atlas of Iron Age Hillforts" — 192 sites carry dating evidence for AD 50–400,
 * and many were reoccupied in the Roman period. Own table, never joined to `sites`.
 *
 * `types` and `datedPeriods` hold the atlas's own yes/no flag columns as small key arrays
 * (see `scripts/import/26-hillforts-atlas.ts` for the vocabularies); `reliability` is the
 * atlas's own judgement of whether a site is a confirmed hillfort. Coordinates are the
 * atlas's WGS 84 `Longitude`/`Latitude` columns, not its OSGB36/IRENET95 grid references.
 * Its long free-text summaries (average 1,094 characters) are deliberately not kept: nothing
 * here would show them, and they would only make every tile heavier if they were ever selected.
 */
export const hillfortReliabilityEnum = pgEnum('hillfort_reliability', [
  'confirmed',
  'unconfirmed',
  'irreconciled',
])

export const antiquityHillforts = pgTable(
  'antiquity_hillforts',
  {
    id: serial('id').primaryKey(),
    /** The atlas's own number, zero-padded as published ("0031"); the natural key. */
    atlasNumber: varchar('atlas_number', { length: 8 }).notNull().unique(),
    name: varchar('name', { length: 240 }).notNull(),
    /** England, Scotland, Wales, Northern Ireland, Republic of Ireland or Isle of Man. */
    country: varchar('country', { length: 40 }).notNull(),
    reliability: hillfortReliabilityEnum('reliability').notNull(),
    types: text('types').array().notNull().default([]),
    datedPeriods: text('dated_periods').array().notNull().default([]),
    areaHectares: numeric('area_hectares', { precision: 10, scale: 3 }),
    altitudeMetres: integer('altitude_metres'),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_hillforts_geom_idx').using('gist', table.geom)],
)

/**
 * Sites read out of the Ancient Sites and Monuments Survey (ODbL 1.0, 1.3 M points) that the
 * survey itself does not date in a column: four of its upstream sources — Villages to Empires
 * (South Levant, CC BY 4.0), Gwiazda's chamber tombs (CC BY 4.0), Marmarica (CC BY 4.0) and
 * the Cornwall & Scilly HER (OGL v3) — state a Hellenistic-to-Byzantine period in prose, which
 * `shared/utils/survey-sites.ts` reads. Own table, never joined to `sites`; the importer
 * (`scripts/import/27-survey-sites.ts`) keeps only what lies more than 500 m from anything the
 * atlas already holds.
 *
 * `periodFrom`/`periodTo` are years (BCE negative) clipped to −800…640; `periodKeys` are the
 * named periods inside that window, in the vocabulary of `SURVEY_PERIOD_KEYS`. `periodBasis` says
 * whether the numbers come from the source's own vocabulary, its explicit dates, or a convention.
 *
 * `destroyed` and `uncertain` are the HER's own judgements ("known from records", "the HER marks
 * this type with a question mark") and are **kept, not filtered**: a levelled round is still
 * evidence that the place was settled, and the interface draws it hollow. `evidence` is what the
 * record rests on (cropmarks, documents, place names, a demolished structure).
 */
export const antiquitySurveySites = pgTable(
  'antiquity_survey_sites',
  {
    id: serial('id').primaryKey(),
    /** The survey's own id ("MS-004712"); the natural key and the audit trail back to the CSV. */
    surveyId: varchar('survey_id', { length: 16 }).notNull().unique(),
    source: varchar('source', { length: 32 }).notNull(),
    name: varchar('name', { length: 240 }).notNull(),
    kind: varchar('kind', { length: 24 }).notNull(),
    periodKeys: text('period_keys').array().notNull().default([]),
    periodFrom: integer('period_from').notNull(),
    periodTo: integer('period_to').notNull(),
    periodBasis: varchar('period_basis', { length: 24 }).notNull(),
    destroyed: boolean('destroyed').notNull().default(false),
    uncertain: boolean('uncertain').notNull().default(false),
    evidence: varchar('evidence', { length: 24 }),
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [index('antiquity_survey_sites_geom_idx').using('gist', table.geom)],
)

export const limesSegmentKindEnum = pgEnum('limes_segment_kind', ['barrier', 'river', 'notional'])

/**
 * The frontier, in named sectors. Same licence family as the tables above and
 * kept here for that reason: every metre is derived from AWMC's extent of the
 * empire and its wall linework, so these rows are ODbL and are never joined to
 * `sites`. The names, dates and prose come from `shared/utils/limes.ts`.
 */
export const limesSectors = pgTable(
  'limes_sectors',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 80 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    latinName: varchar('latin_name', { length: 160 }),
    summary: text('summary'),
    pleiadesId: varchar('pleiades_id', { length: 32 }),
    minYear: integer('min_year'),
    maxYear: integer('max_year'),
    lengthMetres: integer('length_metres').notNull(),
    geom: multiLineGeometry('geom').notNull(),
    /** The longest continuous run, so `ST_LineLocatePoint` has one line to measure along. */
    pathGeom: lineGeometry('path_geom').notNull(),
    /** Derived at import so the camera can fit a sector without reading its geometry. */
    bbox: polygonGeometry('bbox').notNull(),
  },
  (table) => [
    uniqueIndex('limes_sectors_slug_idx').on(table.slug),
    index('limes_sectors_bbox_idx').using('gist', table.bbox),
    index('limes_sectors_path_idx').using('gist', table.pathGeom),
  ],
)

export const limesSegments = pgTable(
  'limes_segments',
  {
    id: serial('id').primaryKey(),
    sectorId: integer('sector_id')
      .notNull()
      .references(() => limesSectors.id, { onDelete: 'cascade' }),
    kind: limesSegmentKindEnum('kind').notNull(),
    certain: boolean('certain').notNull().default(true),
    /**
     * `LimesSource` — `osm`, `ohm`, `vici`, `awmc` or `extent`. A plain varchar
     * rather than an enum so the vocabulary can grow without a migration; rows
     * written before the column existed read as `extent`, which is the safe
     * answer (drawn dashed, as approximate) until the importer is re-run.
     */
    source: varchar('source', { length: 16 }).notNull().default('extent'),
    geom: multiLineGeometry('geom').notNull(),
  },
  (table) => [
    index('limes_segments_geom_idx').using('gist', table.geom),
    index('limes_segments_sector_idx').on(table.sectorId),
  ],
)

/**
 * What the towers of one frontier sector, taken together, could see — the chain
 * of sight between them, the ground they overlook, the stretches of the line no
 * tower watches. Derived: written by `pnpm sightlines:build`, never by a request,
 * because it needs a viewshed from every tower and a sight line between every
 * pair near enough to try (see `.claude/rules/sightlines.md`).
 *
 * **Keyed by the sector's slug, with no foreign key.** `import:limes` rebuilds
 * `limes_sectors` and its serial ids; a result that hung off an id would be
 * deleted by a re-import or, worse, attached to a different sector. The slug is
 * the sector's name; `model_version` and `computed_at` say how old the answer is.
 *
 * `summary` is `SectorWatchSummary`, a few kilobytes; `layers` is a GeoJSON
 * FeatureCollection (ground overlooked, ground watched by three or more, the
 * blind stretches, the links), which can be several hundred kilobytes and is only
 * ever read when the reader asks for it on the map. Both are jsonb because
 * nothing asks a question of them in SQL: they are read whole and served.
 *
 * Licence: derived from ODbL sector geometry, CC BY-SA tower records and terrain
 * models, kept in its own table and in no `/api/data` feed, like every other
 * table in this file.
 */
export const limesSectorSightlines = pgTable('limes_sector_sightlines', {
  sectorSlug: varchar('sector_slug', { length: 80 }).primaryKey(),
  modelVersion: integer('model_version').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  summary: jsonb('summary').notNull(),
  layers: jsonb('layers').notNull(),
})
