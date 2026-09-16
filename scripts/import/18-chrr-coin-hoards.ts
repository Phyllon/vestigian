/**
 * Coin-hoard findspots from Coin Hoards of the Roman Republic (CHRR),
 * numismatics.org/chrr.
 *
 * Licence, verified by fetching both the site's own pages and its
 * machine-readable descriptors, which disagree: the site footer and its
 * `apis` page link ODbL 1.0, but both VoID files
 * (`nomisma.void.rdf`/`pelagios.void.rdf`) declare
 * `dcterms:license` as CC BY-NC 3.0, and each hoard record's own
 * `rightsStmt/copyrightHolder` names "Kris Lockyear", not the American
 * Numismatic Society. The stricter, machine-declared licence is treated
 * as authoritative here — CC BY-NC 3.0, which this project's own
 * conventions already permit (NC is acceptable; nothing here is sold).
 *
 * Source is `findspots.geojson` (fetched and inspected before writing
 * this: 620 features, `{ name, count, uri, type, radius }`), not the full
 * per-hoard NUDS XML — CHRR aggregates 694 individual hoard records to
 * 620 distinct findspot locations with a hoard count each, and that
 * aggregate is what this import holds. It is not a per-hoard breakdown
 * (closing date, coin count, references): CHRR publishes those only
 * through its search UI and per-record XML/RDF, with no bulk CSV or
 * SPARQL endpoint, and scraping 694 individual records for detail this
 * layer doesn't need was not worth the request count.
 *
 *   pnpm import:chrr-coin-hoards
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'chrr-coin-hoards')
const FINDSPOTS_URL = 'https://numismatics.org/chrr/findspots.geojson'

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Same shape as `13-battles.ts`'s `fetchCached` — kept local for the same
 *  reason: `scripts/` has no shared-utility module either script can
 *  import from without pulling in Nitro auto-imports. */
const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const sink = createWriteStream(target)
  await pipeline(source, sink)

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024)} KB`)
  return target
}

interface FindspotFeature {
  geometry: { type: string; coordinates: [number, number] }
  properties: { name: string; count: number; uri: string | null }
}

interface FindspotCollection {
  features: FindspotFeature[]
}

interface HoardRow {
  name: string
  hoardCount: number
  geonamesUrl: string | null
  lon: number
  lat: number
}

const parseFindspots = (collection: FindspotCollection): HoardRow[] => {
  const rows: HoardRow[] = []
  for (const feature of collection.features) {
    if (feature.geometry.type !== 'Point') continue
    const [lon, lat] = feature.geometry.coordinates
    rows.push({
      name: feature.properties.name,
      hoardCount: feature.properties.count,
      geonamesUrl: feature.properties.uri,
      lon,
      lat,
    })
  }
  return rows
}

const insertHoards = async (rows: HoardRow[]): Promise<void> => {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500)
    await sql`
      INSERT INTO antiquity_coin_hoards (name, hoard_count, geonames_url, geom)
      SELECT
        v.name, v.hoard_count::int, v.geonames_url,
        ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.name)}::text[],
        ${batch.map((row) => String(row.hoardCount))}::text[],
        ${batch.map((row) => row.geonamesUrl)}::text[],
        ${batch.map((row) => String(row.lon))}::text[],
        ${batch.map((row) => String(row.lat))}::text[]
      ) AS v(name, hoard_count, geonames_url, lon, lat)
    `
  }
}

const importHoards = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_coin_hoards RESTART IDENTITY`

  const path = await fetchCached(FINDSPOTS_URL, 'findspots.geojson')
  const collection = JSON.parse(await readFile(path, 'utf8')) as FindspotCollection
  const rows = parseFindspots(collection)

  await insertHoards(rows)
  return rows.length
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('CHRR coin-hoard findspots — Coin Hoards of the Roman Republic (CC BY-NC 3.0)\n')

  const total = await importHoards()
  console.log(`${total} findspots imported.`)

  await sql`ANALYZE antiquity_coin_hoards`

  // Rides the atlas cache generation, same as every other antiquity_* import.
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = await redis.keys('coin-hoard:v*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(
      `\nAtlas cache generation is now ${version}; ${stale.length} stale coin-hoard tiles dropped.`,
    )
  } catch (error) {
    console.warn(
      `\nCoin hoards imported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
