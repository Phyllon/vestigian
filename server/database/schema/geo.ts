import { doublePrecision, index, integer, pgTable, serial, varchar } from 'drizzle-orm/pg-core'
import { anyGeometry, pointGeometry } from './sites'

/**
 * Reverse geocoding table, imported from the geonames-derived geo.sql dump in
 * the vici.org repository. Used only to label a site with its modern place, so
 * a full Nominatim instance is not warranted.
 */
export const geoNames = pgTable(
  'geo_names',
  {
    id: integer('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    featureClass: varchar('feature_class', { length: 1 }),
    population: integer('population').notNull().default(0),
    geom: pointGeometry('geom').notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
  },
  (table) => [
    index('geo_names_geom_idx').using('gist', table.geom),
    index('geo_names_country_idx').on(table.countryCode),
  ],
)

/**
 * Real national boundaries (Natural Earth, 1:50m admin-0 countries, public
 * domain — `scripts/import/07-country-boundaries.ts`), for point-in-polygon
 * reverse geocoding. `geo_names` cannot do this job on its own: it is a
 * sparse point set scoped to wherever vici.org's own geo dump happens to
 * cover (five countries), so a nearest-*point* match for a site genuinely
 * outside that area still returns whichever of the five is closest, however
 * far away — measured, and wrong, for 43,479 sites before this table
 * existed. `ST_Contains` against a real polygon has no such failure mode:
 * either a point falls inside a country's boundary or it does not.
 */
export const countryBoundaries = pgTable(
  'country_boundaries',
  {
    id: serial('id').primaryKey(),
    isoA2: varchar('iso_a2', { length: 2 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    geom: anyGeometry('geom').notNull(),
  },
  (table) => [index('country_boundaries_geom_idx').using('gist', table.geom)],
)

/**
 * Modern cities and towns, for the map search bar — a different job from
 * `geoNames` above, which exists only to answer "which country" for a site's
 * own coordinate and is scoped to wherever vici.org's dump happens to cover.
 * This is GeoNames.org's own `cities500` extract (CC BY 4.0, every populated
 * place with 500+ people, worldwide — `scripts/import/09-cities.ts`), kept
 * in its own table for the same reason `antiquity_*` is never joined to
 * `sites`: a modern town is not a record this atlas holds an opinion about,
 * just a place a reader might type into the search field to navigate there.
 *
 * The trigram index that makes `ILIKE`/similarity search on `name` fast
 * (`cities_name_trgm_idx`) is hand-written in the migration, not declared
 * here — drizzle-kit cannot emit an opclass index any more than it can emit
 * `sites_title_trgm_idx`, which has the same omission for the same reason.
 */
export const cities = pgTable(
  'cities',
  {
    id: integer('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    population: integer('population').notNull().default(0),
    geom: pointGeometry('geom').notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
  },
  (table) => [
    index('cities_geom_idx').using('gist', table.geom),
    index('cities_population_idx').on(table.population),
  ],
)
