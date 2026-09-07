/**
 * Three more AWMC layers from the same "Cultural Shapefiles" release
 * `16-awmc-minor-features.ts` reads, all of them lines rather than points:
 * Roman centuriation — the rectangular field-division grids AWMC has
 * traced from aerial photography and cadastral survey, both as lines
 * (2,824 rows, the grid boundaries) and polygons (221 rows, the blocks
 * those grids divide land into) — plus causeways (1 row) and dikes/levees
 * (6 rows), both named like point layers in AWMC's own directory names
 * but confirmed, by reading their actual `.shp` geometry type rather than
 * assuming it from the name, to be `LineString`/`MultiLineString`.
 *
 * Same ODbL 1.0 as `16-awmc-minor-features.ts`, for the same reason (see
 * that file's own docstring and `.claude/rules/antiquity-basemaps.md`). A
 * separate script from that one because these five layers are drawn as
 * part of the Barrington sheet itself, reusing the existing
 * `antiquity_lines`/`antiquity_areas` tables and tile layers `atlas.ts`
 * already serves — not a new toggleable overlay the way the minor point
 * features are.
 *
 * `antiquity_lines.kind` gained `'centuriation'`, `'causeway'` and
 * `'dike_levee'` values for this (see the schema); the polygon half needs
 * no schema change at all, since `antiquity_areas.kind` is already a
 * plain `varchar`, not an enum.
 *
 * The shapefile's own attribute fields (`Source`, `Period`, `timeperiod`
 * on the lines; `approx`, `degree`, `creator` on the centuriation
 * polygons) were inspected before writing this and found almost entirely
 * blank in practice — real records, not fabricated ones, but not worth a
 * column each here: `antiquity_lines.name`/`period` stay null for these
 * rows exactly as they would for a shapefile record with nothing in those
 * fields, and the polygon table carries no attribute beyond its own
 * `kind` and geometry, matching how `urban_areas` is already imported
 * into the same table with no extra columns of its own.
 *
 *   pnpm import:awmc-centuriation
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

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import', 'awmc-centuriation')
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

type LineKind = 'centuriation' | 'causeway' | 'dike_levee'

/**
 * Reads one shapefile of `LineString`/`MultiLineString` features and
 * inserts every one as its own `antiquity_lines` row under `kind` — one
 * row per source fragment, the same convention `antiquity_lines` already
 * uses for AWMC's aqueducts/canals/walls, rather than dissolving them.
 */
const importLineLayer = async (zip: AdmZip, kind: LineKind, dir: string): Promise<number> => {
  const shp = zip.getEntry(`${dir}/${dir}.shp`)?.getData()
  const dbf = zip.getEntry(`${dir}/${dir}.dbf`)?.getData()
  if (!shp || !dbf) throw new Error(`${dir}/${dir}: .shp or .dbf missing from zip`)

  const collection = await readShapefile(shp, dbf)
  const wkts: string[] = []

  for (const feature of collection.features) {
    if (feature.geometry?.type === 'LineString') {
      const points = (feature.geometry.coordinates as [number, number][])
        .map(([lon, lat]) => `${lon} ${lat}`)
        .join(', ')
      wkts.push(`MULTILINESTRING((${points}))`)
    } else if (feature.geometry?.type === 'MultiLineString') {
      const lines = (feature.geometry.coordinates as [number, number][][])
        .map((line) => {
          const points = line.map(([lon, lat]) => `${lon} ${lat}`).join(', ')
          return `(${points})`
        })
        .join(', ')
      wkts.push(`MULTILINESTRING(${lines})`)
    }
  }

  await sql`DELETE FROM antiquity_lines WHERE kind = ${kind}`
  for (let start = 0; start < wkts.length; start += 250) {
    const batch = wkts.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_lines (kind, geom)
      SELECT ${kind}::antiquity_line_kind, ST_SetSRID(ST_GeomFromText(v.wkt), 4326)
      FROM unnest(${batch}::text[]) AS v(wkt)
    `
  }
  return wkts.length
}

const importCenturiationPolygons = async (zip: AdmZip): Promise<number> => {
  const shp = zip.getEntry('centuriation/centuriation_polygons.shp')?.getData()
  const dbf = zip.getEntry('centuriation/centuriation_polygons.dbf')?.getData()
  if (!shp || !dbf) {
    throw new Error('centuriation/centuriation_polygons: .shp or .dbf missing from zip')
  }

  const collection = await readShapefile(shp, dbf)
  const wkts: string[] = []
  for (const feature of collection.features) {
    if (feature.geometry?.type !== 'Polygon') continue
    const rings = (feature.geometry.coordinates as [number, number][][])
      .map((ring) => {
        const points = ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')
        return `(${points})`
      })
      .join(', ')
    wkts.push(`MULTIPOLYGON((${rings}))`)
  }

  await sql`DELETE FROM antiquity_areas WHERE kind = 'centuriation'`
  for (let start = 0; start < wkts.length; start += 250) {
    const batch = wkts.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_areas (kind, geom)
      SELECT 'centuriation', ST_SetSRID(ST_GeomFromText(v.wkt), 4326)
      FROM unnest(${batch}::text[]) AS v(wkt)
    `
  }
  return wkts.length
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('AWMC centuriation, causeways and dikes/levees (ODbL 1.0)\n')

  const zipPath = await fetchCached(ZIP_URL, 'cultural-shapefiles.zip')
  const zip = new AdmZip(await readFile(zipPath))

  const centuriationLines = await importLineLayer(zip, 'centuriation', 'centuriation')
  const centuriationPolygons = await importCenturiationPolygons(zip)
  const causeways = await importLineLayer(zip, 'causeway', 'causeways')
  const dikesLevees = await importLineLayer(zip, 'dike_levee', 'dikes_levees')

  console.log(`  centuriation: ${centuriationLines} grid lines, ${centuriationPolygons} blocks`)
  console.log(`  causeways: ${causeways}`)
  console.log(`  dikes/levees: ${dikesLevees}`)

  await sql`ANALYZE antiquity_lines`
  await sql`ANALYZE antiquity_areas`

  // Rides the atlas cache generation, same as every other antiquity_* import.
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    await redis.del('vestigian:atlas-version')
    const version = await redis.incr('vestigian:atlas-version')
    console.log(`\nAtlas cache generation is now ${version}.`)
  } catch (error) {
    console.warn(
      `\nImported, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
