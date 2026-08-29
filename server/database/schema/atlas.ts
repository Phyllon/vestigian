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
import { pointGeometry } from './sites'

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
    geom: pointGeometry('geom').notNull(),
  },
  (table) => [
    uniqueIndex('antiquity_places_pleiades_idx').on(table.pleiadesId),
    index('antiquity_places_geom_idx').using('gist', table.geom),
  ],
)
