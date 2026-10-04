/**
 * The neighbours of the Roman state, as dated boundary slices, from Cliopatria —
 * the Seshat Global History Databank's geospatial dataset of ~1,600 historical
 * polities, 3400 BCE to 2024 CE.
 *
 * **Licence, read from the release rather than assumed:** the repository's
 * `LICENSE.md` states "This data is licensed under a Creative Commons
 * Attribution 4.0 International License" and the Zenodo record
 * (10.5281/zenodo.20274630, v0.2.0, 2026-05-16) says `cc-by-4.0`, which agree.
 *
 * **Why only the neighbours — decided by measuring, not by taste.** The point of
 * the check was whether Cliopatria adds anything the atlas does not already
 * have. For the Roman state itself it does not: the Roman Empire slices average
 * about 1,300 vertices against OpenHistoricalMap's ~83,000 for a single slice
 * (see `19-ohm-empire-extents.ts`), and the slice counts are comparable. So the
 * five Roman entries are excluded and the Roman state keeps coming from OHM. What
 * Cliopatria *does* add is **93 other polities** (87 once the alias entries are dropped) active between 509 BCE and 476
 * CE that touch Europe and the Mediterranean — Carthage, the Achaemenid,
 * Seleucid, Ptolemaic, Parthian and Sasanian empires, Pontus, Numidia, Armenia,
 * the Nabataeans, the Goths, Huns, Vandals and Visigoths — none of which the atlas
 * drew at all. Each carries a Wikidata id and a Wikipedia page. They are coarse
 * (roughly 50 to 500 vertices a slice) and the dataset itself warns that its maps
 * "reflect only one version of the territory held by past polities", so the map
 * draws them as faint context under the Roman extent and says so.
 *
 * `RELATION` rows ("Allegiance of Seleucid Empire to Roman Republic") are not
 * territories and are skipped, and so are the 29 slices of six parenthesised alias entries,
 * each of which has a twin with the identical outline (19 slices are geometrically equal to
 * their twin's) — kept, they would draw a realm and its label twice.
 *
 * **Where Cliopatria and OHM disagree, OHM wins, at tile time.** Checked at all 51 scrubber
 * steps: up to 66 BCE the neighbours sit outside the Roman extent, but from 27 BCE up to six
 * realms lie 96–100 % inside it (client kingdoms OHM counts as Roman), and from 407 CE the
 * Franks, Visigoths, Burgundians and Vandals lie inside the Western empire OHM draws until
 * 476. `buildPolityTileSql` therefore cuts each neighbour by the Roman extent of the same
 * year. Nothing is clipped *here*, so the stored outlines stay exactly what Cliopatria
 * published. Years are Cliopatria's own integers, negative for
 * BCE, stored as given.
 *
 * Source is the release asset pinned to tag v0.2.0 (44 MB zipped, 165 MB
 * GeoJSON), not the 297 MB Zenodo bundle, which adds 6,000 PNG scans.
 *
 *   pnpm import:cliopatria-polities
 *   pnpm import:cliopatria-polities -- --dry-run
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { refreshAtlasCache } from './atlas-cache'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'cliopatria')
const SOURCE_URL =
  'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.0/cliopatria.geojson.zip'
const SOURCE_ID = 'seshat:cliopatria:v0.2.0'
const BATCH_SIZE = 100

/** The span the period scrubber covers — see `19-ohm-empire-extents.ts`. */
export const WINDOW_FROM_YEAR = -509
export const WINDOW_TO_YEAR = 476

/** Europe and the Mediterranean: west, south, east, north. */
export const REGION_BOUNDS = { west: -12, south: 30, east: 45, north: 62 } as const

/** Excluded because the Roman state comes from OHM, which is far more detailed. */
export const ROMAN_ENTRIES: ReadonlySet<string> = new Set([
  'Roman Kingdom',
  'Roman Republic',
  'Roman Empire',
  'Western Roman Empire',
  'Eastern Roman Empire',
])

export interface PolityFeature {
  properties: {
    Name: string
    FromYear: number
    ToYear: number
    Area: number
    Type: string
    Wikipedia: string
    Wikidata: string
  }
  geometry: { type: string; coordinates: unknown }
}

export interface PolityRow {
  name: string
  fromYear: number
  toYear: number
  wikidataId: string | null
  wikipediaTitle: string | null
  areaSquareKilometres: number | null
  geometry: PolityFeature['geometry']
}

/** Extent of any GeoJSON coordinate nesting: [west, south, east, north]. */
export const extentOf = (coordinates: unknown): [number, number, number, number] => {
  const extent: [number, number, number, number] = [180, 90, -180, -90]

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      extent[0] = Math.min(extent[0], node[0])
      extent[1] = Math.min(extent[1], node[1])
      extent[2] = Math.max(extent[2], node[0])
      extent[3] = Math.max(extent[3], node[1])
      return
    }
    node.forEach(walk)
  }

  walk(coordinates)
  return extent
}

export const overlapsRegion = (geometry: PolityFeature['geometry']): boolean => {
  const [west, south, east, north] = extentOf(geometry.coordinates)
  return (
    east > REGION_BOUNDS.west &&
    west < REGION_BOUNDS.east &&
    north > REGION_BOUNDS.south &&
    south < REGION_BOUNDS.north
  )
}

/** Null for anything this layer does not draw — see the file docstring. */
export const parsePolityFeature = (feature: PolityFeature): PolityRow | null => {
  const { Name, FromYear, ToYear, Area, Type, Wikipedia, Wikidata } = feature.properties

  if (Type !== 'POLITY') return null
  if (ROMAN_ENTRIES.has(Name)) return null
  // Seshat's alias entries — "(Macedonian Empire)" beside "Macedonian Empire". Each of the six has a
  // twin with the identical outline, so keeping them only drew every realm and its label twice.
  if (Name.startsWith('(')) return null
  if (ToYear < WINDOW_FROM_YEAR || FromYear > WINDOW_TO_YEAR) return null
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return null
  if (!overlapsRegion(feature.geometry)) return null

  return {
    name: Name.trim().slice(0, 200),
    fromYear: FromYear,
    toYear: ToYear,
    wikidataId: /^Q\d+$/.test(Wikidata) ? Wikidata : null,
    wikipediaTitle: Wikipedia.trim() ? Wikipedia.trim().slice(0, 240) : null,
    areaSquareKilometres: Number.isFinite(Area) ? Math.round(Area) : null,
    geometry: feature.geometry,
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const downloadArchive = async (path: string): Promise<void> => {
  if (await exists(path)) return

  process.stdout.write('  ↓ cliopatria.geojson.zip (v0.2.0) … ')
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) throw new Error(`${SOURCE_URL} answered ${response.status}`)

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  )
  const { size } = await stat(path)
  console.log(`${Math.round(size / 1024 / 1024)} MB`)
}

const insertBatch = async (rows: PolityRow[]): Promise<void> => {
  await sql`
    INSERT INTO antiquity_polities
      (name, from_year, to_year, wikidata_id, wikipedia_title, area_square_kilometres, geom)
    SELECT
      e->>'name', (e->>'fromYear')::int, (e->>'toYear')::int,
      e->>'wikidataId', e->>'wikipediaTitle', (e->>'areaSquareKilometres')::int,
      ST_Multi(ST_CollectionExtract(
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON((e->'geometry')::text), 4326)), 3
      ))
    FROM jsonb_array_elements(${sql.json(rows as unknown as postgres.JSONValue)}) AS e
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log(
    'Cliopatria polities (neighbours of Rome) — CC BY 4.0, Seshat Global History Databank.\n',
  )

  const archivePath = join(CACHE_DIR, 'cliopatria.geojson.zip')
  await downloadArchive(archivePath)

  const archive = await readFile(archivePath)
  const entry = new AdmZip(archive)
    .getEntries()
    .find(
      (candidate) =>
        candidate.entryName.endsWith('.geojson') && !candidate.entryName.startsWith('__MACOSX'),
    )
  if (!entry) throw new Error('No .geojson inside cliopatria.geojson.zip')

  const collection = JSON.parse(entry.getData().toString('utf8')) as { features: PolityFeature[] }
  const rows = collection.features.flatMap((feature) => parsePolityFeature(feature) ?? [])
  const polities = new Set(rows.map((row) => row.name)).size
  console.log(
    `${rows.length} slices of ${polities} polities kept from ${collection.features.length} features.`,
  )

  const checksum = checksumOfSource(archive)
  const proceed = await guardImport({
    sql,
    source: SOURCE_ID,
    rowCount: rows.length,
    checksum,
    dryRun: isDryRun(process.argv),
  })
  if (!proceed) {
    await sql.end()
    return
  }

  await sql`TRUNCATE antiquity_polities RESTART IDENTITY`
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insertBatch(rows.slice(start, start + BATCH_SIZE))
  }
  await sql`ANALYZE antiquity_polities`
  await recordImportRun(sql, { source: SOURCE_ID, rowCount: rows.length, checksum })

  const [summary] = await sql<{ slices: number; polities: number; invalid: number }[]>`
    SELECT count(*)::int AS slices, count(DISTINCT name)::int AS polities,
           count(*) FILTER (WHERE NOT ST_IsValid(geom))::int AS invalid
    FROM antiquity_polities
  `
  console.log(
    `${summary?.slices} slices of ${summary?.polities} polities in antiquity_polities (${summary?.invalid} invalid geometries).`,
  )

  await refreshAtlasCache(['reference:polities:*'])
  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
