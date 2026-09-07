import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
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
    geom: multiLineGeometry('geom').notNull(),
  },
  (table) => [
    index('limes_segments_geom_idx').using('gist', table.geom),
    index('limes_segments_sector_idx').on(table.sectorId),
  ],
)
