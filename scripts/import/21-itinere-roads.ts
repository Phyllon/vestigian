/**
 * Itiner-e — the digital atlas of ancient roads, itiner-e.org (Brughmans,
 * Pažout, de Soto and Bjerregaard Vahlstrup; Aarhus University).
 *
 * **Licence, read from the source rather than assumed:** `itiner-e.org/about`
 * states "Itiner-e: the digital atlas of ancient roads © 2024 by Brughmans,
 * Pažout, de Soto and Bjerregaard Vahlstrup is licensed under CC BY 4.0"
 * (fetched 3 Oct 2026). The Zenodo record's own licence field is empty, so the
 * site's statement is the one cited.
 *
 * **Source is the citable static release, not the nightly export.**
 * Zenodo record 17122148 (doi:10.5281/zenodo.17122148, "Itiner-e static
 * version 2024", published 2025-09-15) is fixed and reproducible; the site's
 * own `/route-segments/download` is rebuilt every night and would make a
 * re-import silently differ from the last. The GeoJSON (78 MB) is used rather
 * than the 34 MB GeoPackage because it needs no GDAL: 14,769 MultiLineString
 * segments, 299,171 km, about a million vertices, 5,698 main and 9,071
 * secondary roads. **Certainty is the useful part** — 1,040 segments are
 * `Certain`, 12,952 `Conjectured` and 777 `Hypothetical` — and the map draws
 * them differently so a reader can tell a surveyed road from a modelled one.
 *
 * **The coordinates are EPSG:3395 (World Mercator), not WGS 84**, with a Z
 * (elevation) on every vertex — read from the file's own `crs` member, not
 * from a sample. They are reprojected and flattened in PostGIS
 * (`ST_Transform(ST_SetSRID(…, 3395), 4326)`), which is exact and needs no
 * JavaScript projection library.
 *
 * Kept in its own table, never joined to `sites` or `antiquity_lines`: a
 * different scholarship under a different licence, and the Barrington roads in
 * `antiquity_lines` stay as they are.
 *
 *   pnpm import:itinere-roads
 *   pnpm import:itinere-roads -- --dry-run
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { refreshAtlasCache } from './atlas-cache'
import { checksumOfSource, guardImport, isDryRun, recordImportRun } from './guard'

const sql = postgres(requireDatabaseUrl(), { max: 1 })

const CACHE_DIR = join(process.cwd(), '.import', 'itinere')
const SOURCE_URL = 'https://zenodo.org/api/records/17122148/files/itinere_roads.geojson/content'
const SOURCE_ID = 'zenodo:17122148:itinere_roads'
const BATCH_SIZE = 250

export type RoadCertainty = 'certain' | 'conjectured' | 'hypothetical'

export interface ItinereFeature {
  properties: {
    Name: string | null
    Route_Type: number
    Itinerary: string | null
    Segment_s: string | null
    Citation: string | null
    Bibliograp: string | null
  }
  geometry: { type: string; coordinates: unknown }
}

export interface RoadRow {
  name: string | null
  isMain: boolean
  certainty: RoadCertainty
  itinerary: string | null
  citation: string | null
  bibliography: string | null
  geometry: ItinereFeature['geometry']
}

/**
 * Itiner-e's `Segment_s` has exactly three values in the release. An
 * unfamiliar one is a changed vocabulary, not something to file under a
 * default — it throws, so the import stops instead of mislabelling roads.
 */
export const certaintyOf = (segment: string | null): RoadCertainty => {
  const normalised = segment?.trim().toLowerCase()
  if (normalised === 'certain') return 'certain'
  if (normalised === 'conjectured') return 'conjectured'
  if (normalised === 'hypothetical') return 'hypothetical'
  throw new Error(`Unknown Itiner-e Segment_s value: ${JSON.stringify(segment)}`)
}

const clean = (value: string | null | undefined, maximum: number): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, maximum) : null
}

/** Null for anything that is not a line: the table holds MultiLineStrings only. */
export const parseRoadFeature = (feature: ItinereFeature): RoadRow | null => {
  if (feature.geometry.type !== 'MultiLineString' && feature.geometry.type !== 'LineString') {
    return null
  }

  return {
    name: clean(feature.properties.Name, 240),
    isMain: feature.properties.Route_Type === 2,
    certainty: certaintyOf(feature.properties.Segment_s),
    itinerary: clean(feature.properties.Itinerary, 160),
    citation: clean(feature.properties.Citation, 300),
    bibliography: clean(feature.properties.Bibliograp, 400),
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

const fetchCached = async (url: string, name: string): Promise<string> => {
  const target = join(CACHE_DIR, name)
  if (await exists(target)) return target

  process.stdout.write(`  ↓ ${name} … `)
  const response = await fetch(url, {
    headers: { 'user-agent': 'Vestigian-atlas-import/1.0 (contact: project maintainer)' },
  })
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`)

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(target),
  )

  const { size } = await stat(target)
  console.log(`${Math.round(size / 1024 / 1024)} MB`)
  return target
}

const insertBatch = async (rows: RoadRow[]): Promise<void> => {
  await sql`
    INSERT INTO antiquity_roman_roads
      (name, is_main, certainty, itinerary, citation, bibliography, geom)
    SELECT
      e->>'name',
      (e->>'isMain')::boolean,
      (e->>'certainty')::antiquity_road_certainty,
      e->>'itinerary',
      e->>'citation',
      e->>'bibliography',
      ST_Multi(ST_Force2D(ST_Transform(
        ST_SetSRID(ST_GeomFromGeoJSON((e->'geometry')::text), 3395), 4326
      )))
    FROM jsonb_array_elements(${sql.json(rows as unknown as postgres.JSONValue)}) AS e
  `
}

const main = async (): Promise<void> => {
  await mkdir(CACHE_DIR, { recursive: true })
  console.log('Itiner-e Roman roads — CC BY 4.0, itiner-e.org (static release 2024).\n')

  const path = await fetchCached(SOURCE_URL, 'itinere_roads.geojson')
  const raw = await readFile(path)
  const collection = JSON.parse(raw.toString('utf8')) as {
    crs?: { properties?: { name?: string } }
    features: ItinereFeature[]
  }

  // The reprojection below hard-codes EPSG:3395; a release in another CRS would
  // land every road in the wrong place without any error, so check the file.
  const crs = collection.crs?.properties?.name ?? ''
  if (!crs.endsWith('EPSG::3395')) {
    throw new Error(`Expected EPSG:3395 coordinates, the file declares ${JSON.stringify(crs)}`)
  }

  const rows = collection.features.flatMap((feature) => parseRoadFeature(feature) ?? [])
  console.log(`${rows.length} road segments parsed.`)

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

  // The audit is keyed by road id, which RESTART IDENTITY reassigns — see `road-audit.ts`.
  await sql`TRUNCATE antiquity_roman_roads, road_audit_segments RESTART IDENTITY`
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insertBatch(rows.slice(start, start + BATCH_SIZE))
    if ((start / BATCH_SIZE) % 10 === 9) console.log(`· roads ${start + BATCH_SIZE}/${rows.length}`)
  }

  await sql`ANALYZE antiquity_roman_roads`
  await recordImportRun(sql, {
    source: SOURCE_ID,
    rowCount: rows.length,
    checksum: checksumOfSource(raw),
  })

  const [summary] = await sql<{ segments: number; km: number }[]>`
    SELECT count(*)::int AS segments,
           round((sum(ST_Length(geom::geography)) / 1000)::numeric)::int AS km
    FROM antiquity_roman_roads
  `
  console.log(`${summary?.segments} segments, ${summary?.km} km in antiquity_roman_roads.`)

  await refreshAtlasCache(['reference:roman-roads:*'])

  await sql.end()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
