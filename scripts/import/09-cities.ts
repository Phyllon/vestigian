/**
 * Imports GeoNames.org's `cities500` extract (CC BY 4.0) — every populated
 * place with 500+ people, worldwide, ~235,700 rows — so the map search bar
 * can find a modern city or town, not only Vestigian's own contributed sites.
 *
 * A different table from `geo_names` (`02c-geo-names.ts`), on purpose:
 * `geo_names` exists only to answer "which country" for a site's own
 * coordinate and is a sparse point set scoped to wherever vici.org's dump
 * happens to cover (five countries). `cities` is worldwide, keyed for name
 * search rather than nearest-point lookup, and serves a different feature —
 * see the docstring on `cities` in `server/database/schema/geo.ts`.
 *
 * The source is a `.zip` — the only import in this pipeline that is, hence
 * the one new dependency (`adm-zip`, script-only, not part of the deployed
 * server). `cities500.txt` is tab-separated in GeoNames' own fixed 19-column
 * "geoname" format; only the columns this table actually stores are read out
 * of it, everything else (alternate names, elevation, admin-division codes,
 * a modification date) is discarded on the way in rather than carried
 * forward unused.
 *
 *   pnpm import:cities
 */
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'
import postgres from 'postgres'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import')
const SOURCE_URL = 'https://download.geonames.org/export/dump/cities500.zip'
/** Names the upstream, not this file — the script may be renamed, the source may not. */
const SOURCE_ID = 'geonames:cities500'
const BATCH_SIZE = 1000

const exists = async (path: string): Promise<boolean> =>
  stat(path)
    .then(() => true)
    .catch(() => false)

const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(target),
  )

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024 / 1024)} MB`)
  return target
}

interface CityRow {
  id: number
  name: string
  countryCode: string
  population: number
  lat: number
  lon: number
}

/**
 * GeoNames' fixed columns: geonameid, name, asciiname, alternatenames,
 * latitude, longitude, feature class, feature code, country code, cc2,
 * admin1-4 codes, population, elevation, dem, timezone, modification date.
 * Only the seven this table stores are read.
 */
const parseCitiesFile = (contents: string): CityRow[] => {
  const rows: CityRow[] = []

  for (const line of contents.split('\n')) {
    if (!line) continue
    const fields = line.split('\t')
    const [id, name, , , lat, lon, , , countryCode, , , , , , population] = fields
    if (!id || !name || !countryCode || !lat || !lon) continue

    rows.push({
      id: Number(id),
      name,
      countryCode,
      population: Number(population) || 0,
      lat: Number(lat),
      lon: Number(lon),
    })
  }

  return rows
}

const insertBatch = async (rows: CityRow[]): Promise<void> => {
  await sql`
    INSERT INTO cities (id, name, country_code, population, geom, lat, lon)
    SELECT
      v.id, v.name, v.country_code, v.population,
      ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326),
      v.lat, v.lon
    FROM unnest(
      ${rows.map((row) => row.id)}::integer[],
      ${rows.map((row) => row.name)}::text[],
      ${rows.map((row) => row.countryCode)}::text[],
      ${rows.map((row) => row.population)}::integer[],
      ${rows.map((row) => row.lat)}::double precision[],
      ${rows.map((row) => row.lon)}::double precision[]
    ) AS v(id, name, country_code, population, lat, lon)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      country_code = EXCLUDED.country_code,
      population = EXCLUDED.population,
      geom = EXCLUDED.geom,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing modern cities and towns — CC BY 4.0, GeoNames.org cities500.\n')

  const zipPath = await fetchCached(SOURCE_URL, 'cities500.zip')
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry('cities500.txt')
  if (!entry) throw new Error('cities500.txt not found inside cities500.zip')

  // Checksummed from the extracted bytes rather than the .zip, so a source
  // rebuilt with identical content but a different compression timestamp does
  // not read as a changed dataset.
  const raw = entry.getData()
  const rows = parseCitiesFile(raw.toString('utf8'))
  console.log(`${rows.length} places parsed.`)

  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    rowCount: rows.length,
    checksum: checksumOfSource(raw),
    dryRun: isDryRun(process.argv),
  })

  if (!proceed) {
    await sql.end()
    return
  }

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    await insertBatch(batch)
    console.log(`· cities ${Math.min(offset + BATCH_SIZE, rows.length)}/${rows.length}`)
  }

  // After the write, never before: a run that dies halfway must not leave a
  // baseline claiming rows it never actually wrote.
  await recordImportRun(sql, {
    source: SOURCE_ID,
    rowCount: rows.length,
    checksum: checksumOfSource(raw),
  })

  const [result] = await sql<{ count: string }[]>`SELECT count(*)::text FROM cities`
  console.log(`\n${result?.count ?? 0} rows in cities.`)

  await sql.end()
}

await main()
