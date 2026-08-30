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
