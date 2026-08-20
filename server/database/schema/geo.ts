import { doublePrecision, index, integer, pgTable, varchar } from 'drizzle-orm/pg-core'
import { pointGeometry } from './sites'

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
