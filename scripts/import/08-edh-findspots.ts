/**
 * Imports EDH (Epigraphic Database Heidelberg) findspot data —
 * `geography/edhGeographicData.json` in the EDH data-dumps mirror, CC BY-SA
 * 4.0 — for cross-referencing and verifying sites against inscription
 * findspots.
 *
 * This is a bulk import, not a live source, because EDH has no live
 * geographic search API to be one: its only programmatic per-record
 * endpoint is a DTS document lookup by EDH id, returning EpiDoc XML, and
 * vici.org's own import never captured an `edh` concordance scheme to look
 * documents up by in the first place (confirmed: `KNOWN_SCHEMES` in
 * `02-mysql-to-postgres.ts` has no such entry). What EDH does publish for
 * reuse is this static, daily-regenerated GeoJSON dump.
 *
 * Each feature already carries a `pleiades_uri` and/or `trismegistos_geo_uri`
 * — a direct identifier cross-reference, not a coordinate to fuzzy-match
 * against. That is what makes this usable at all without a search API: a
 * site with a matching `external_ids` row for either scheme resolves to an
 * EDH findspot by identifier join (`scripts/verify-concordances.ts`), the
 * same shape as the Wikidata→Pleiades/DARE resolution ladder in
 * `enrichment-sources.ts`.
 *
 * A bulk table, never joined to `sites` — CC BY-SA 4.0's share-alike
 * attaches to a derivative database, the same reasoning that keeps
 * `antiquity_*` separate (see `atlas.ts`).
 *
 *   pnpm import:edh-findspots
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import')
const SOURCE_URL =
  'https://raw.githubusercontent.com/epigraphic-database-heidelberg/data/master/geography/edhGeographicData.json'

interface EdhFeature {
  type: 'Feature'
  properties: {
    uri: string
    ancient_findspot?: string
    pleiades_uri?: string
    trismegistos_geo_uri?: string
  }
  geometry: { type: 'Point'; coordinates: [number, number] } | null
}

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

/** Trailing numeric id from a Pleiades or Trismegistos place URI. */
const trailingId = (uri: string | undefined): string | null => {
  if (!uri) return null
  const match = /\/(\d+)\/?$/.exec(uri)
  return match ? match[1]! : null
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Importing EDH findspots — CC BY-SA 4.0, epigraphic-database-heidelberg/data.\n')

  const path = await fetchCached(SOURCE_URL, 'edhGeographicData.json')
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { features: EdhFeature[] }

  await sql`TRUNCATE edh_findspots RESTART IDENTITY`

  const rows = parsed.features
    .filter((feature) => feature.geometry?.type === 'Point')
    .map((feature) => ({
      edhUri: feature.properties.uri,
      ancientFindspot: feature.properties.ancient_findspot ?? null,
      pleiadesId: trailingId(feature.properties.pleiades_uri),
      trismegistosId: trailingId(feature.properties.trismegistos_geo_uri),
      lon: feature.geometry!.coordinates[0],
      lat: feature.geometry!.coordinates[1],
    }))

  const BATCH_SIZE = 1000
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    await sql`
      INSERT INTO edh_findspots (edh_uri, ancient_findspot, pleiades_id, trismegistos_id, geom)
      SELECT
        v.edh_uri, v.ancient_findspot, v.pleiades_id, v.trismegistos_id,
        ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.edhUri)}::text[],
        ${batch.map((row) => row.ancientFindspot)}::text[],
        ${batch.map((row) => row.pleiadesId)}::text[],
        ${batch.map((row) => row.trismegistosId)}::text[],
        ${batch.map((row) => row.lon)}::double precision[],
        ${batch.map((row) => row.lat)}::double precision[]
      ) AS v(edh_uri, ancient_findspot, pleiades_id, trismegistos_id, lon, lat)
    `
    console.log(`· edh_findspots ${Math.min(offset + BATCH_SIZE, rows.length)}/${rows.length}`)
  }

  const withPleiades = rows.filter((row) => row.pleiadesId).length
  const withTrismegistos = rows.filter((row) => row.trismegistosId).length
  console.log(`\n${rows.length} findspots imported.`)
  console.log(`  · ${withPleiades} carry a Pleiades id, ${withTrismegistos} a Trismegistos id.`)
  console.log('Next: pnpm exec tsx scripts/verify-concordances.ts')

  await sql.end()
}

await main()
