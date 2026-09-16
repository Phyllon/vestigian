/**
 * Small AWMC point layers that ship only in its "Cultural Shapefiles"
 * release, never as GeoJSON: bridges, mines/quarries, dams, cemeteries,
 * Barrington's own scattered forts (ten points worldwide — not the limes
 * frontier's own contributed fortifications, a separate and much larger
 * layer) and tumuli.
 *
 * Source: `github.com/AWMC/geodata`, `Cultural Shapefiles Apr 2024.zip`
 * (25.4 MB, fetched and unpacked to inspect the real attribute schema
 * before this import was written — DBF field names are truncated to 10
 * characters and undocumented outside the shapefiles themselves; the
 * repo's own `attribute_information.md` describes only the GeoJSON side's
 * vocabulary, which does not match). Same ODbL 1.0 as every other AWMC
 * table this project already imports, per the repo's root `LICENSE.txt` —
 * the README's "the GeoJSONs continue to provide the most up-to-date
 * data" is a freshness caveat, not a narrower licence grant; `LICENSE.txt`
 * covers the repository, not one folder in it.
 *
 * Two layers in the same zip named like points turned out, on actually
 * reading their `.shp` geometry type rather than assuming it from the
 * layer name, to be lines: `causeways` and `dikes_levees`. They are
 * imported by `17-awmc-centuriation.ts` instead, into `antiquity_lines`.
 *
 * Two more layers were checked and deliberately NOT imported at all:
 * `roads/New_BA_Roads_2017` (4,229 lines, no name field) and
 * `pleiades places/pleiades_places` (34,834 points) both duplicate data
 * this project already imports more completely elsewhere — the former is
 * the layer AWMC's own README says is staler than the GeoJSON `roads`
 * already imported by `05-antiquity-atlas.ts`, the latter a bundled copy
 * of the same Pleiades gazetteer already imported directly from Pleiades
 * (38,002 rows in `antiquity_places`, against 34,834 here). Re-importing
 * either would double-draw the map rather than add anything to it. A
 * further layer, `urban footprints/urban_footprint` (94 records), was
 * checked and is the same story against the already-imported
 * `urban_areas` (95 records).
 *
 * Unified into one table (`antiquity_features`) rather than six: the
 * combined count is ~525 rows, and every layer shares the same shape — a
 * point, a name that is usually blank, a Barrington map-sheet citation.
 *
 *   pnpm import:awmc-features
 */
import { mkdir, readFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'
import { Redis } from 'ioredis'
import postgres from 'postgres'
import { read as readShapefile } from 'shapefile'
import { requireDatabaseUrl } from '../../server/database/database-url'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'awmc-minor-features')
const ZIP_URL =
  'https://raw.githubusercontent.com/AWMC/geodata/master/Cultural%20Shapefiles%20Apr%202024.zip'

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

type FeatureKind = 'bridge' | 'mine_quarry' | 'dam' | 'cemetery' | 'fort' | 'tumulus'

interface FeatureRow {
  kind: FeatureKind
  name: string | null
  source: string | null
  material: string | null
  periods: string | null
  lon: number
  lat: number
}

/** A scalar as text. Anything structured is not a value this import can use. */
const text = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return null
  }
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

/** `ba_bridges`' five period-attestation flags, read off as they actually
 *  are in the DBF (0/1 numbers) rather than assumed — confirmed by reading
 *  real records before writing this. */
const BRIDGE_PERIOD_LABELS: Record<string, string> = {
  Archaic: 'Archaic',
  Classical: 'Classical',
  Hell_Rome: 'Hellenistic-Roman',
  Roman: 'Roman',
  Late: 'Late Antique',
}

const bridgePeriods = (properties: Record<string, unknown>): string | null => {
  const attested = Object.entries(BRIDGE_PERIOD_LABELS)
    .filter(([field]) => Number(properties[field]) === 1)
    .map(([, label]) => label)
  return attested.length > 0 ? attested.join(', ') : null
}

interface ShapefileLayer {
  kind: FeatureKind
  dir: string
  base: string
  toRow: (properties: Record<string, unknown>) => Omit<FeatureRow, 'kind' | 'lon' | 'lat'>
}

const LAYERS: ShapefileLayer[] = [
  {
    kind: 'bridge',
    dir: 'ba_bridges',
    base: 'ba_bridges',
    toRow: (p) => ({
      name: text(p.Name),
      source: text(p.Source),
      material: null,
      periods: bridgePeriods(p),
    }),
  },
  {
    kind: 'mine_quarry',
    dir: 'mines_quarries',
    base: 'mines_quarries',
    toRow: (p) => ({
      name: null,
      source: null,
      material: text(p.Material),
      periods: text(p.Period),
    }),
  },
  {
    kind: 'dam',
    dir: 'dams',
    base: 'dams',
    toRow: (p) => ({
      name: null,
      source: text(p.Source),
      material: null,
      periods: text(p.timeperiod),
    }),
  },
  {
    kind: 'cemetery',
    dir: 'cemeteries',
    base: 'cemeteries',
    toRow: (p) => ({
      name: null,
      source: text(p.Source),
      material: null,
      periods: text(p.timeperiod),
    }),
  },
  {
    kind: 'fort',
    dir: 'forts',
    base: 'forts',
    toRow: (p) => ({
      name: null,
      source: text(p.Source),
      material: null,
      periods: text(p.timeperiod),
    }),
  },
  {
    kind: 'tumulus',
    dir: 'tumuli',
    base: 'tumuli',
    toRow: (p) => ({
      name: null,
      source: text(p.Source),
      material: null,
      periods: text(p.timeperiod),
    }),
  },
]

const parseLayer = async (zip: AdmZip, layer: ShapefileLayer): Promise<FeatureRow[]> => {
  const shp = zip.getEntry(`${layer.dir}/${layer.base}.shp`)?.getData()
  const dbf = zip.getEntry(`${layer.dir}/${layer.base}.dbf`)?.getData()
  if (!shp || !dbf) throw new Error(`${layer.dir}/${layer.base}: .shp or .dbf missing from zip`)

  const collection = await readShapefile(shp, dbf)
  const rows: FeatureRow[] = []

  for (const feature of collection.features) {
    if (feature.geometry?.type !== 'Point') continue
    const [lon, lat] = feature.geometry.coordinates as [number, number]
    rows.push({
      kind: layer.kind,
      lon,
      lat,
      ...layer.toRow((feature.properties ?? {}) as Record<string, unknown>),
    })
  }
  return rows
}

const insertFeatures = async (rows: FeatureRow[]): Promise<void> => {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500)
    await sql`
      INSERT INTO antiquity_features (kind, name, source, material, periods, geom)
      SELECT
        v.kind::antiquity_feature_kind, v.name, v.source, v.material, v.periods,
        ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.kind)}::text[],
        ${batch.map((row) => row.name)}::text[],
        ${batch.map((row) => row.source)}::text[],
        ${batch.map((row) => row.material)}::text[],
        ${batch.map((row) => row.periods)}::text[],
        ${batch.map((row) => String(row.lon))}::text[],
        ${batch.map((row) => String(row.lat))}::text[]
      ) AS v(kind, name, source, material, periods, lon, lat)
    `
  }
}

const importFeatures = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_features RESTART IDENTITY`

  const zipPath = await fetchCached(ZIP_URL, 'cultural-shapefiles.zip')
  const zip = new AdmZip(await readFile(zipPath))

  let total = 0
  for (const layer of LAYERS) {
    const rows = await parseLayer(zip, layer)
    await insertFeatures(rows)
    console.log(`  ${layer.kind}: ${rows.length}`)
    total += rows.length
  }
  return total
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('AWMC minor features — bridges, mines, dams and more (ODbL 1.0)\n')

  const total = await importFeatures()
  console.log(`\n${total} features imported.`)

  await sql`ANALYZE antiquity_features`

  // Rides the atlas cache generation, same as every other antiquity_* import.
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    const stale = await redis.keys('feature:v*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(
      `\nAtlas cache generation is now ${version}; ${stale.length} stale feature tiles dropped.`,
    )
  } catch (error) {
    console.warn(
      `\nFeatures imported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
