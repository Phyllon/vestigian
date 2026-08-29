/**
 * Builds the antiquity atlas: the reference cartography the 'antiquity-awmc'
 * basemap is drawn from.
 *
 * Two sources, both openly licensed and both downloaded from where their
 * publishers put them rather than scraped from a map application:
 *
 *   AWMC       github.com/AWMC/geodata — ODbL 1.0, stated in LICENSE.txt and
 *              the README. Derived from the Barrington Atlas of the Greek and
 *              Roman World plus AWMC's own OpenStreetMap edits. Ancient
 *              coastline, open water, inland water, roads, aqueducts, canals,
 *              walls, urban extents and the region/people names.
 *   Pleiades   atlantides.org/downloads/pleiades — CC BY 3.0. ~42,000 ancient
 *              places with representative points, feature types and dates.
 *
 * ODbL's share-alike attaches to a derivative *database*, which is why every
 * row here lands in its own `antiquity_*` table and is never joined to `sites`.
 * Rendered tiles are a Produced Work and need only the attribution the basemap
 * style carries. Mixing the two would put the public GeoJSON feed under ODbL.
 *
 * Resumable in the way that matters: downloads are cached in `.import/atlas/`
 * and skipped if present, so a re-run after a failed insert costs no bandwidth.
 * Each layer is replaced wholesale rather than merged — this is reference data
 * with no local edits to preserve.
 *
 *   pnpm import:atlas
 *   ATLAS_SKIP_OPEN_WATER=1 pnpm import:atlas   # ~240 MB less to download
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { parse } from 'csv-parse'
import { Redis } from 'ioredis'
import postgres from 'postgres'

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
  { max: 1 },
)

const CACHE_DIR = join(process.cwd(), '.import', 'atlas')
const AWMC_RAW = 'https://raw.githubusercontent.com/AWMC/geodata/master'
const PLEIADES_PLACES =
  'https://atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.csv.gz'

/**
 * Sea polygons, by region. AWMC splits these into twenty files totalling ~330
 * MB; these ten are the ones touching the Roman world, and the rest are the
 * Arctic, the Indian Ocean and sub-Saharan Africa. Skipping them entirely still
 * yields a usable sheet — coastline, rivers and roads on paper — which is what
 * ATLAS_SKIP_OPEN_WATER is for on a slow connection.
 */
const OPEN_WATER_REGIONS = [
  'OW_Atlantic',
  'OW_British',
  'OW_Iberia',
  'OW_Adriatic_Tyrhhenian',
  'OW_Aegean',
  'OW_East_Med',
  'OW_Black_Sea',
  'OW_Red_Sea',
  'OW_Baltic_1',
  'OW_Baltic_2',
]

/**
 * Sea polygons carry OpenStreetMap-grade detail — eighty thousand vertices for
 * one stretch of the East Mediterranean — and the basemap stops at zoom 12.
 * Reducing on the way in is the difference between a tile query that reads a
 * few hundred kilobytes and one that reads tens of megabytes; roughly 20 m,
 * which is a third of a pixel at the deepest zoom this map draws.
 */
const WATER_SIMPLIFY_DEGREES = 0.0002

interface GeoJsonFeature {
  type: string
  properties: Record<string, unknown> | null
  geometry: { type: string; coordinates: unknown } | null
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Downloads once into `.import/atlas/`. GitHub and Pleiades both serve these as
 * static files, so a re-run of a failed import should not fetch them again —
 * two hundred megabytes is not much, but it is not nothing either.
 */
const fetchCached = async (url: string, name: string, gunzip = false): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`)
  }

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const sink = createWriteStream(target)
  await (gunzip ? pipeline(source, createGunzip(), sink) : pipeline(source, sink))

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024 / 1024)} MB`)
  await wait(250)
  return target
}

const readFeatures = async (path: string): Promise<GeoJsonFeature[]> => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { features?: GeoJsonFeature[] }
  return (parsed.features ?? []).filter((feature) => feature.geometry !== null)
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed.length === 0 || trimmed === 'null' ? null : trimmed
}

/** AWMC writes flags as the strings "0" and "1", and sometimes as nothing at all. */
const flag = (value: unknown): boolean => text(value) === '1'

const year = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed !== 0 ? Math.round(parsed) : null
}

/** The last path segment of a Pleiades URI, which is the id everything else uses. */
const pleiadesId = (value: unknown): string | null => {
  const raw = text(value)
  if (!raw) return null
  const id = raw.split('/').filter(Boolean).pop()
  return id && /^\d+$/.test(id) ? id : null
}

interface LineImport {
  kind: 'road' | 'aqueduct' | 'canal' | 'wall' | 'shoreline'
  file: string
  /** Reads AWMC's per-layer property names into the shared shape. */
  read: (properties: Record<string, unknown>) => {
    name: string | null
    major: boolean
    certain: boolean
    period: string | null
  }
}

const LINE_IMPORTS: LineImport[] = [
  {
    kind: 'shoreline',
    file: 'shoreline.geojson',
    read: () => ({ name: null, major: false, certain: true, period: null }),
  },
  {
    kind: 'road',
    file: 'roads.geojson',
    // `Known_or_a` is Barrington's own distinction between a road whose course
    // is established and one inferred from termini; drawn dashed rather than
    // solid, so the map does not assert more than the atlas does.
    read: (p) => ({
      name: text(p.Name) ?? text(p.en_name),
      major: flag(p.Major_or_M),
      certain: flag(p.Known_or_a),
      period: text(p.timeperiod),
    }),
  },
  {
    kind: 'aqueduct',
    file: 'aqueducts.geojson',
    read: (p) => ({
      name: text(p.Name) ?? text(p.en_name),
      major: false,
      certain: true,
      period: text(p.timeperiod),
    }),
  },
  {
    kind: 'canal',
    file: 'canals.geojson',
    read: (p) => ({
      name: text(p.Name),
      major: false,
      certain: true,
      period: text(p.timeperiod),
    }),
  },
  {
    kind: 'wall',
    file: 'walls.geojson',
    read: (p) => ({
      name: null,
      major: false,
      certain: text(p.known) !== '0',
      period: text(p.timeperiod),
    }),
  },
]

const AWMC_LINE_PATHS: Record<string, string> = {
  'shoreline.geojson': 'Physical%20Data/shoreline/shoreline.geojson',
  'roads.geojson': 'Cultural-Data/roads/roads.geojson',
  'aqueducts.geojson': 'Cultural-Data/aqueducts/aqueducts.geojson',
  'canals.geojson': 'Cultural-Data/canals/canals.geojson',
  'walls.geojson': 'Cultural-Data/walls/walls.geojson',
}

/**
 * Inserted in batches, as parallel arrays unnested into a row set.
 *
 * `sql(rows, ...columns)` cannot be used here: it expands to a VALUES list for
 * a plain INSERT, and every geometry has to pass through `ST_GeomFromGeoJSON`
 * on the way in — which needs a SELECT to wrap it. `unnest` of one typed array
 * per column is the shape that allows both, and it still sends the whole batch
 * as a single bound statement rather than a row at a time.
 */
const insertLines = async (
  rows: {
    kind: string
    name: string | null
    major: boolean
    certain: boolean
    period: string | null
    geometry: string
  }[],
): Promise<void> => {
  for (let start = 0; start < rows.length; start += 250) {
    const batch = rows.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_lines (kind, name, major, certain, period, geom)
      SELECT
        v.kind::antiquity_line_kind,
        v.name,
        v.major::boolean,
        v.certain::boolean,
        v.period,
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326))
      FROM unnest(
        ${batch.map((row) => row.kind)}::text[],
        ${batch.map((row) => row.name)}::text[],
        ${batch.map((row) => String(row.major))}::text[],
        ${batch.map((row) => String(row.certain))}::text[],
        ${batch.map((row) => row.period)}::text[],
        ${batch.map((row) => row.geometry)}::text[]
      ) AS v(kind, name, major, certain, period, geometry)
    `
  }
}

const importLines = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_lines RESTART IDENTITY`
  let total = 0

  for (const layer of LINE_IMPORTS) {
    const path = await fetchCached(`${AWMC_RAW}/${AWMC_LINE_PATHS[layer.file]}`, layer.file)
    const features = await readFeatures(path)

    await insertLines(
      features.map((feature) => ({
        kind: layer.kind,
        ...layer.read(feature.properties ?? {}),
        geometry: JSON.stringify(feature.geometry),
      })),
    )

    console.log(`  ${layer.kind}: ${features.length}`)
    total += features.length
  }

  return total
}

const insertWater = async (
  rows: { kind: string; name: string | null; geometry: string }[],
): Promise<void> => {
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100)
    await sql`
      INSERT INTO antiquity_water (kind, name, geom)
      SELECT
        v.kind::antiquity_water_kind,
        v.name,
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(
              ST_SimplifyPreserveTopology(
                ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326), ${WATER_SIMPLIFY_DEGREES}
              )
            ),
            3
          )
        )
      FROM unnest(
        ${batch.map((row) => row.kind)}::text[],
        ${batch.map((row) => row.name)}::text[],
        ${batch.map((row) => row.geometry)}::text[]
      ) AS v(kind, name, geometry)
    `
  }
}

const importWater = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_water RESTART IDENTITY`

  const inlandPath = await fetchCached(
    `${AWMC_RAW}/Physical%20Data/inland_water/inland-water-OSM.geojson`,
    'inland-water.geojson',
  )
  const inland = await readFeatures(inlandPath)
  await insertWater(
    inland.map((feature) => ({
      kind: 'inland',
      name: text(feature.properties?.NAME) ?? text(feature.properties?.EN_NAME),
      geometry: JSON.stringify(feature.geometry),
    })),
  )
  console.log(`  inland water: ${inland.length}`)
  let total = inland.length

  if (process.env.ATLAS_SKIP_OPEN_WATER === '1') {
    console.log('  open water: skipped (ATLAS_SKIP_OPEN_WATER=1)')
    return total
  }

  for (const region of OPEN_WATER_REGIONS) {
    const path = await fetchCached(
      `${AWMC_RAW}/Physical%20Data/open_water_osm_edits/${region}.geojson`,
      `${region}.geojson`,
    )
    const features = await readFeatures(path)
    await insertWater(
      features.map((feature) => ({
        kind: 'sea',
        name: null,
        geometry: JSON.stringify(feature.geometry),
      })),
    )
    console.log(`  ${region}: ${features.length}`)
    total += features.length
  }

  return total
}

const importAreas = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_areas RESTART IDENTITY`

  const path = await fetchCached(
    `${AWMC_RAW}/Cultural-Data/urban_areas/urban_areas.geojson`,
    'urban_areas.geojson',
  )
  const features = await readFeatures(path)

  const rows = features.map((feature) => ({
    kind: 'urban',
    name: text(feature.properties?.title),
    pleiades_id: pleiadesId(feature.properties?.pleiadesid),
    geometry: JSON.stringify(feature.geometry),
  }))

  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100)
    await sql`
      INSERT INTO antiquity_areas (kind, name, pleiades_id, geom)
      SELECT v.kind, v.name, v.pleiades_id,
             ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326))
      FROM unnest(
        ${batch.map((row) => row.kind)}::text[],
        ${batch.map((row) => row.name)}::text[],
        ${batch.map((row) => row.pleiades_id)}::text[],
        ${batch.map((row) => row.geometry)}::text[]
      ) AS v(kind, name, pleiades_id, geometry)
    `
  }

  console.log(`  urban areas: ${rows.length}`)
  return rows.length
}

/**
 * Region and people names. AWMC draws the extent as linework rather than a
 * filled polygon, so there is nothing to take a centroid of in the usual sense;
 * `ST_Centroid` of the collected lines is the balance point of the drawn
 * boundary, which for a region outline is close enough to its middle to hang a
 * label on and costs nothing at read time.
 */
const importRegions = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_regions RESTART IDENTITY`

  const path = await fetchCached(
    `${AWMC_RAW}/Cultural-Data/regional_name_linework/regional_names_linework.geojson`,
    'regional_names.geojson',
  )
  const features = await readFeatures(path)

  const rows = features
    .map((feature) => {
      const properties = feature.properties ?? {}
      return {
        title: text(properties.TITLE),
        kind: text(properties.TYPE) ?? text(properties.P_TYPE),
        pleiades_id: pleiadesId(properties.PID),
        min_year: year(properties.P_MIN_DATE) ?? year(properties.MINDATE),
        max_year: year(properties.P_MAX_DATE) ?? year(properties.MAXDATE),
        geometry: JSON.stringify(feature.geometry),
      }
    })
    // A nameless region is linework with nothing to say; the layer exists to
    // put "Raetia" and "Belgae" on the map.
    .filter((row): row is typeof row & { title: string } => row.title !== null)

  for (let start = 0; start < rows.length; start += 250) {
    const batch = rows.slice(start, start + 250)
    await sql`
      INSERT INTO antiquity_regions (title, kind, pleiades_id, min_year, max_year, geom, label_geom)
      SELECT
        v.title, v.kind, v.pleiades_id, v.min_year::int, v.max_year::int,
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326)),
        ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(v.geometry), 4326))
      FROM unnest(
        ${batch.map((row) => row.title)}::text[],
        ${batch.map((row) => row.kind)}::text[],
        ${batch.map((row) => row.pleiades_id)}::text[],
        ${batch.map((row) => (row.min_year === null ? null : String(row.min_year)))}::text[],
        ${batch.map((row) => (row.max_year === null ? null : String(row.max_year)))}::text[],
        ${batch.map((row) => row.geometry)}::text[]
      ) AS v(title, kind, pleiades_id, min_year, max_year, geometry)
    `
  }

  console.log(`  regions and peoples: ${rows.length}`)
  return rows.length
}

interface PlaceInsert {
  pleiades_id: string
  title: string
  description: string | null
  feature_types: string | null
  min_year: number | null
  max_year: number | null
  location_precision: string | null
  lon: number
  lat: number
}

interface PleiadesRow {
  id: string
  title: string
  description: string
  featureTypes: string
  minDate: string
  maxDate: string
  reprLat: string
  reprLong: string
  locationPrecision: string
}

/**
 * A Pleiades record whose title is a placeholder. Roughly 4,400 of the 42,000
 * are "Untitled" or "Unnamed road" — real records, correctly unnamed, but a map
 * covered in the word "Untitled" tells the reader nothing and crowds out the
 * names that do. They are dropped rather than imported and filtered at read
 * time, so the label layer never has to think about them.
 */
const UNNAMED_TITLE = /^(untitled|unnamed|unknown)\b/i

/**
 * Pleiades ships one row per place with a representative point. Places with no
 * location — attested in a text but never located — are the majority of what is
 * dropped here, and they have nothing to draw.
 */
const importPlaces = async (): Promise<number> => {
  await sql`TRUNCATE antiquity_places RESTART IDENTITY`

  const path = await fetchCached(PLEIADES_PLACES, 'pleiades-places.csv', true)
  const parser = parse({ columns: true, skip_empty_lines: true, relax_quotes: true })
  const source = Readable.from([await readFile(path, 'utf8')])

  let batch: PlaceInsert[] = []
  let imported = 0

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    await sql`
      INSERT INTO antiquity_places
        (pleiades_id, title, description, feature_types, min_year, max_year,
         location_precision, geom)
      SELECT
        v.pleiades_id, v.title, v.description, v.feature_types,
        v.min_year::int, v.max_year::int, v.location_precision,
        ST_SetSRID(ST_MakePoint(v.lon::double precision, v.lat::double precision), 4326)
      FROM unnest(
        ${batch.map((row) => row.pleiades_id)}::text[],
        ${batch.map((row) => row.title)}::text[],
        ${batch.map((row) => row.description)}::text[],
        ${batch.map((row) => row.feature_types)}::text[],
        ${batch.map((row) => (row.min_year === null ? null : String(row.min_year)))}::text[],
        ${batch.map((row) => (row.max_year === null ? null : String(row.max_year)))}::text[],
        ${batch.map((row) => row.location_precision)}::text[],
        ${batch.map((row) => row.lon)}::double precision[],
        ${batch.map((row) => row.lat)}::double precision[]
      ) AS v(pleiades_id, title, description, feature_types, min_year, max_year,
             location_precision, lon, lat)
      ON CONFLICT (pleiades_id) DO NOTHING
    `
    imported += batch.length
    batch = []
  }

  for await (const record of source.pipe(parser)) {
    const row = record as unknown as PleiadesRow
    const lat = Number(row.reprLat)
    const lon = Number(row.reprLong)
    const id = text(row.id)

    const title = text(row.title)
    if (!id || !title || UNNAMED_TITLE.test(title)) continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    batch.push({
      pleiades_id: id,
      title: title.slice(0, 300),
      description: text(row.description),
      feature_types: text(row.featureTypes)?.slice(0, 240) ?? null,
      min_year: year(row.minDate),
      max_year: year(row.maxDate),
      location_precision: text(row.locationPrecision),
      lon,
      lat,
    })

    if (batch.length >= 500) await flush()
  }

  await flush()
  console.log(`  Pleiades places: ${imported}`)
  return imported
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('Antiquity atlas — AWMC (ODbL 1.0) and Pleiades (CC BY 3.0)\n')

  await importLines()
  await importWater()
  await importAreas()
  await importRegions()
  await importPlaces()

  // ANALYZE rather than VACUUM: the planner has no statistics for tables that
  // were empty a minute ago, and without them the first tile requests choose a
  // sequential scan over the GiST index that was just built.
  await sql`ANALYZE antiquity_water, antiquity_lines, antiquity_areas, antiquity_regions, antiquity_places`

  /**
   * Bumped here rather than left to the operator. Every atlas tile is cached
   * under this generation for a week, so a rebuild that does not change it is
   * invisible — the import reports success and the map keeps drawing the old
   * sheet. Doing it by hand also invites the trap that the counter starts at
   * one *by default*, so the first INCR of an unset key is a no-op.
   */
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    // Cleared rather than incremented: an unset key already reads as 1, so the
    // first increment would leave the prefix where it was.
    await redis.del('vestigia:atlas-version')
    const version = await redis.incr('vestigia:atlas-version')
    const stale = await redis.keys('atlas:v*')
    if (stale.length > 0) await redis.del(...stale)
    console.log(`\nAtlas cache generation is now ${version}; ${stale.length} stale tiles dropped.`)
  } catch (error) {
    console.warn(
      `\nAtlas rebuilt, but the cache generation could not be bumped ` +
        `(${(error as Error).message}). Until it is, the map keeps serving the previous sheet.`,
    )
  } finally {
    redis.disconnect()
  }

  await sql.end()
}

await main()
