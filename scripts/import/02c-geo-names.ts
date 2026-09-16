/**
 * Populates `geo_names` from vici.org's `geo.sql.gz` dump — a GeoNames-derived
 * `geo_allcountries` table (447,053 rows: geonameid, name, lat/lon, feature
 * class, population, a 2-letter country code).
 *
 * This step was missing entirely. `01-fetch-dump.ts` already downloads
 * `geo.sql.gz` into the scratch MariaDB alongside `vici.sql.gz`, and the
 * Postgres table exists (`server/database/migrations/0000_initial.sql`), but
 * nothing ever transferred one into the other — `geo_names` sat empty. It was
 * documented as "already holds what a reverse-geocode backfill would need,"
 * which was itself unverified; it does not, until this runs once.
 *
 * Rows with no country code are skipped outright — the one thing this table
 * exists for is reverse-geocoding a site to a country
 * (`scripts/backfill-country-codes.ts`), and a geoname that cannot answer
 * that question is not useful data for this purpose, whatever else it might
 * be.
 *
 *   pnpm import:geo-names
 */
import mysql from 'mysql2/promise'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'

const BATCH_SIZE = 1000

const source = await mysql.createConnection(
  process.env.MYSQL_GEO_URL ?? 'mysql://root:root@127.0.0.1:3307/geo',
)

const target = postgres(requireDatabaseUrl())

interface GeoRow {
  id: number
  name: string
  countryCode: string
  featureClass: string | null
  population: number | null
  lat: number
  lon: number
}

/**
 * One bound statement per batch via `unnest`, not one `INSERT` per row —
 * the same shape `05-antiquity-atlas.ts` uses for its own high-row-count
 * imports, needed here for the same reason: 447,053 individual round trips
 * would take considerably longer than parallel arrays unnested into a row
 * set.
 */
const insertBatch = async (rows: GeoRow[]): Promise<void> => {
  await target`
    INSERT INTO geo_names (id, name, country_code, feature_class, population, geom, lat, lon)
    SELECT
      v.id::integer,
      v.name,
      v.country_code,
      v.feature_class,
      v.population::integer,
      ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326),
      v.lat::double precision,
      v.lon::double precision
    FROM unnest(
      ${rows.map((row) => row.id)}::integer[],
      ${rows.map((row) => row.name)}::text[],
      ${rows.map((row) => row.countryCode)}::text[],
      ${rows.map((row) => row.featureClass)}::text[],
      ${rows.map((row) => row.population)}::integer[],
      ${rows.map((row) => row.lat)}::double precision[],
      ${rows.map((row) => row.lon)}::double precision[]
    ) AS v(id, name, country_code, feature_class, population, lat, lon)
    ON CONFLICT (id) DO NOTHING
  `
}

const main = async (): Promise<void> => {
  console.log('Importing geo_names from the geonames-derived geo.sql dump…\n')

  const [rows] = await source.query<mysql.RowDataPacket[]>(
    `SELECT geonameid AS id, name, country AS countryCode, fclass AS featureClass,
            population, latitude AS lat, longitude AS lon
     FROM geo_allcountries
     WHERE country IS NOT NULL AND country <> ''
       AND latitude IS NOT NULL AND longitude IS NOT NULL
       AND name IS NOT NULL AND name <> ''`,
  )

  const geoRows = (rows as unknown as GeoRow[]).map((row) => ({
    ...row,
    population: row.population ?? 0,
  }))

  console.log(`${geoRows.length} rows with a usable country code, of ${rows.length} total.\n`)

  for (let offset = 0; offset < geoRows.length; offset += BATCH_SIZE) {
    const batch = geoRows.slice(offset, offset + BATCH_SIZE)
    await insertBatch(batch)
    console.log(`· geo_names ${Math.min(offset + BATCH_SIZE, geoRows.length)}/${geoRows.length}`)
  }

  const [result] = await target<{ count: string }[]>`SELECT count(*)::text FROM geo_names`
  console.log(`\n${result?.count ?? 0} rows in geo_names.`)
  console.log('Next: pnpm exec tsx scripts/backfill-country-codes.ts')

  await source.end()
  await target.end()
}

await main()
