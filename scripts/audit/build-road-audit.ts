/**
 * Reads every conjectured and hypothetical Itiner-e road against the rest of the
 * atlas: which milestone and road records stand within a stated buffer of it,
 * whether it continues a surveyed segment, how steep its steepest stretch is —
 * and, the other way round, which located milestones stand far from every road.
 * Written to `road_audit_segments` and `road_audit_gaps` for the road-audit
 * overlay and its download. Evidence, never a verdict: see `shared/utils/road-audit.ts`
 * and `.claude/rules/road-audit.md`.
 *
 * A script and not a request because the gradient needs terrain under every one
 * of 13,700 segments — about 5,000 tiles at zoom 10 — and the counts are a join
 * across four tables.
 *
 *   pnpm roads:audit                 every segment, terrain at zoom 10
 *   pnpm roads:audit -- --zoom 12    finer terrain (use the mirror: ~37,000 tiles)
 *   pnpm roads:audit -- --no-slope   counts and gaps only, no terrain requests
 *
 * Needs the terrain unless `--no-slope`: `NUXT_PUBLIC_BASEMAP_TERRAIN_URL` (the
 * mirror) or, when it is empty, Mapterhorn's own tiles — which is a free public
 * service, so prefer the mirror for anything but a one-off. Run it again after
 * `pnpm import:itinere-roads` (which empties the table), after the EDH or vici
 * records change in bulk, or when `ROAD_AUDIT_MODEL_VERSION` moves.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'
import { loadTerrainField } from '../../server/utils/terrain'
import {
  fillElevationGaps,
  samplePolyline,
  summariseElevationProfile,
} from '../../shared/utils/elevation-profile'
import {
  ROAD_AUDIT_BUFFER_METRES,
  ROAD_AUDIT_GRADIENT_WINDOW_METRES,
  ROAD_AUDIT_MODEL_VERSION,
  ROAD_AUDIT_STEEP_GRADIENT_PERCENT,
  ROAD_GAP_DISTANCE_METRES,
  percentileOf,
  summariseRoadAudit,
} from '../../shared/utils/road-audit'
import { refreshAtlasCache } from '../import/atlas-cache'

const sql = postgres(requireDatabaseUrl(), { max: 2 })
const TERRAIN_URL = process.env.NUXT_PUBLIC_BASEMAP_TERRAIN_URL ?? ''

const DEFAULT_TERRAIN_ZOOM = 10
/**
 * A fixed spacing and a count high enough never to widen it: Itiner-e segments run
 * to 190 km, and a cap of a few hundred samples had made the gradient window of a
 * long segment several times that of a short one, so the two were not comparable.
 */
const SAMPLE_MINIMUM_STEP_METRES = 50
const SAMPLE_MAXIMUM_COUNT = 8000
const UPDATE_BATCH_SIZE = 500
/** Segments whose terrain is loaded together; ~150 of them touch a few dozen 512 px tiles. */
const TERRAIN_CHUNK_SEGMENTS = 150
/** A box wide enough for the buffer at the northern edge of the data (300 m is 0.0055° of longitude at 60°N). */
const CANDIDATE_BOX_DEGREES = 0.012
/** Where to look for the nearest road of a milestone that is far from all of them. */
const NEAREST_ROAD_BOX_DEGREES = 0.05

interface Options {
  terrainZoom: number
  withSlope: boolean
}

const readOptions = (argv: readonly string[]): Options => {
  const zoomIndex = argv.indexOf('--zoom')
  const zoom = zoomIndex === -1 ? DEFAULT_TERRAIN_ZOOM : Number(argv[zoomIndex + 1])
  if (!Number.isInteger(zoom) || zoom < 6 || zoom > 12) {
    throw new Error('--zoom takes a whole number from 6 to 12.')
  }
  return { terrainZoom: zoom, withSlope: !argv.includes('--no-slope') }
}

const writeCounts = async (): Promise<void> => {
  await sql.begin(async (transaction) => {
    await transaction`DELETE FROM road_audit_segments`
    await transaction`DELETE FROM road_audit_gaps`

    await transaction`
      INSERT INTO road_audit_segments (
        road_id, length_metres, edh_milestones, vici_milestones, vici_road_sites,
        certain_ends, model_version
      )
      SELECT
        road.id,
        round(ST_Length(road.geom::geography))::int,
        (SELECT count(*) FROM inscriptions find
          WHERE find.inscription_type = 'milestone' AND find.geom IS NOT NULL
            AND find.geom && ST_Expand(road.geom, ${CANDIDATE_BOX_DEGREES})
            AND ST_DWithin(find.geom::geography, road.geom::geography, ${ROAD_AUDIT_BUFFER_METRES})),
        (SELECT count(*) FROM sites find
          WHERE find.subcategory = 'milestone' AND find.status = 'approved'
            AND find.geom && ST_Expand(road.geom, ${CANDIDATE_BOX_DEGREES})
            AND ST_DWithin(find.geom::geography, road.geom::geography, ${ROAD_AUDIT_BUFFER_METRES})),
        (SELECT count(*) FROM sites find
          WHERE find.subcategory = 'road' AND find.status = 'approved'
            AND find.geom && ST_Expand(road.geom, ${CANDIDATE_BOX_DEGREES})
            AND ST_DWithin(find.geom::geography, road.geom::geography, ${ROAD_AUDIT_BUFFER_METRES})),
        (SELECT count(*) FROM (
            VALUES (ST_StartPoint(ST_GeometryN(road.geom, 1))),
                   (ST_EndPoint(ST_GeometryN(road.geom, ST_NumGeometries(road.geom))))
          ) AS ends (point)
          WHERE EXISTS (
            SELECT 1 FROM antiquity_roman_roads surveyed
            WHERE surveyed.certainty = 'certain' AND surveyed.id <> road.id
              AND surveyed.geom && ST_Expand(ends.point, ${CANDIDATE_BOX_DEGREES})
              AND ST_DWithin(surveyed.geom::geography, ends.point::geography, ${ROAD_AUDIT_BUFFER_METRES})
          )),
        ${ROAD_AUDIT_MODEL_VERSION}
      FROM antiquity_roman_roads road
      WHERE road.certainty <> 'certain'
    `

    await transaction`
      INSERT INTO road_audit_gaps (source, source_key, title, nearest_road_metres, model_version, geom)
      SELECT source, source_key, left(title, 240), round(nearest)::int, ${ROAD_AUDIT_MODEL_VERSION}, geom
      FROM (
        SELECT 'edh' AS source, find.edh_id AS source_key,
               coalesce(find.find_modern_place || ' — ' || find.title, find.title) AS title,
               find.geom, nearest.metres AS nearest
        FROM inscriptions find
        CROSS JOIN LATERAL (
          SELECT min(ST_Distance(road.geom::geography, find.geom::geography)) AS metres
          FROM antiquity_roman_roads road
          WHERE road.geom && ST_Expand(find.geom, ${NEAREST_ROAD_BOX_DEGREES})
        ) nearest
        WHERE find.inscription_type = 'milestone' AND find.geom IS NOT NULL
        UNION ALL
        SELECT 'vici', find.slug, find.title, find.geom, nearest.metres
        FROM sites find
        CROSS JOIN LATERAL (
          SELECT min(ST_Distance(road.geom::geography, find.geom::geography)) AS metres
          FROM antiquity_roman_roads road
          WHERE road.geom && ST_Expand(find.geom, ${NEAREST_ROAD_BOX_DEGREES})
        ) nearest
        WHERE find.subcategory = 'milestone' AND find.status = 'approved'
      ) located
      WHERE nearest IS NULL OR nearest > ${ROAD_GAP_DISTANCE_METRES}
    `
  })
}

interface SegmentGeometry {
  id: number
  certainty: string
  geometry: string
}

interface GradientReading {
  gradient: number | null
  coverage: number | null
}

/**
 * Gradient of one segment, read from a terrain field that already covers it.
 * Null when the segment is shorter than the window or has no terrain under it.
 */
const readSteepestGradient = (
  parts: [number, number][][],
  elevationAt: (lon: number, lat: number) => number | null,
): GradientReading => {
  const { samples, lengthMetres } = samplePolyline({
    parts,
    minimumStepMetres: SAMPLE_MINIMUM_STEP_METRES,
    maximumSamples: SAMPLE_MAXIMUM_COUNT,
  })
  if (lengthMetres < ROAD_AUDIT_GRADIENT_WINDOW_METRES) return { gradient: null, coverage: null }

  const readings = samples.map((sample) => elevationAt(sample.position.lon, sample.position.lat))
  const { elevations, coverage } = fillElevationGaps(readings)
  if (coverage === 0) return { gradient: null, coverage: 0 }

  const stats = summariseElevationProfile({
    distances: samples.map((sample) => sample.distanceMetres),
    elevations,
    gradientWindowMetres: ROAD_AUDIT_GRADIENT_WINDOW_METRES,
  })
  return { gradient: Math.abs(stats.steepestGradientPercent), coverage }
}

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Mapterhorn's own tile addresses; any other terrain URL is passed through untouched. */
const MAPTERHORN_TILE = /^https:\/\/tiles\.mapterhorn\.com\/(\d+)\/(\d+)\/(\d+)\.webp$/
const TERRAIN_CACHE_DIR = join(process.cwd(), '.import', 'terrain')

/**
 * Counts terrain requests and keeps each Mapterhorn tile on disk (`.import/`), so
 * a second run — after a parameter moves, or a fix — asks nobody for anything.
 * Mapterhorn is a free public service; the build is 5,200 tiles at zoom 10 and
 * should be fetched once, not once per attempt.
 */
const instrumentTerrainRequests = async (): Promise<{
  total: () => number
  unique: () => number
  fromDisk: () => number
}> => {
  await mkdir(TERRAIN_CACHE_DIR, { recursive: true })
  const seen = new Set<string>()
  let total = 0
  let fromDisk = 0
  const original = globalThis.fetch

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = requestUrl(input)
    const match = MAPTERHORN_TILE.exec(url)
    if (!match) return original(input, init)

    total++
    seen.add(url)
    const file = join(TERRAIN_CACHE_DIR, `${match[1]}-${match[2]}-${match[3]}.webp`)
    try {
      const cached = await readFile(file)
      fromDisk++
      return new Response(cached, { status: 200 })
    } catch {
      // Not on disk yet: fetch it, and keep it if it is a real tile.
    }
    const response = await original(input, init)
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer())
      await writeFile(file, bytes)
      return new Response(bytes, { status: 200 })
    }
    return response
  }) as typeof fetch

  return { total: () => total, unique: () => seen.size, fromDisk: () => fromDisk }
}

const writeGradients = async (options: Options): Promise<number[]> => {
  const requests = await instrumentTerrainRequests()

  // Spatial order, so neighbouring segments share the decoded tiles the loader keeps.
  const roads = await sql<SegmentGeometry[]>`
    SELECT road.id, road.certainty::text AS certainty, ST_AsGeoJSON(road.geom) AS geometry
    FROM antiquity_roman_roads road
    ORDER BY floor(ST_Y(ST_Centroid(road.geom)) * 4), ST_X(ST_Centroid(road.geom))
  `

  const surveyedGradients: number[] = []
  const startedAt = Date.now()
  let done = 0

  const store = async (
    readings: { id: number; gradient: number | null; coverage: number | null }[],
  ): Promise<void> => {
    for (let offset = 0; offset < readings.length; offset += UPDATE_BATCH_SIZE) {
      const batch = readings.slice(offset, offset + UPDATE_BATCH_SIZE)
      await sql`
        UPDATE road_audit_segments AS audit
        SET steepest_gradient_percent = v.gradient, terrain_coverage = v.coverage
        FROM (
          SELECT * FROM unnest(
            ${batch.map((row) => row.id)}::int[],
            ${batch.map((row) => row.gradient)}::real[],
            ${batch.map((row) => row.coverage)}::real[]
          ) AS t (id, gradient, coverage)
        ) AS v
        WHERE audit.road_id = v.id
      `
    }
  }

  // A chunk at a time, so the tiles under it are fetched six at a time instead of
  // the one or two a single segment needs — which is what made one-by-one take hours.
  for (let offset = 0; offset < roads.length; offset += TERRAIN_CHUNK_SEGMENTS) {
    const chunk = roads.slice(offset, offset + TERRAIN_CHUNK_SEGMENTS)
    const parsed = chunk.map((road) => ({
      road,
      parts: (JSON.parse(road.geometry) as { coordinates: [number, number][][] }).coordinates,
    }))
    const positions = parsed.flatMap(({ parts }) =>
      parts.flatMap((part) => part.map(([lon, lat]) => ({ lon: lon!, lat: lat! }))),
    )

    const field = await loadTerrainField({
      area: { positions },
      terrainUrl: TERRAIN_URL,
      zoom: options.terrainZoom,
    })

    const stored: { id: number; gradient: number | null; coverage: number | null }[] = []
    for (const { road, parts } of parsed) {
      const reading = readSteepestGradient(parts, field.elevationAt)
      if (road.certainty === 'certain') {
        // Not stored — surveyed roads are not audited — only used to set the parameter.
        if (reading.gradient !== null) surveyedGradients.push(reading.gradient)
      } else {
        stored.push({ id: road.id, ...reading })
      }
    }
    await store(stored)

    done += chunk.length
    const minutes = ((Date.now() - startedAt) / 60000).toFixed(1)
    console.log(
      `· ${done}/${roads.length} segments, ${requests.unique()} terrain tiles (${requests.total()} requests), ${minutes} min`,
    )
  }

  console.log(
    `Terrain: ${requests.unique()} distinct tiles, ${requests.total()} requests (${requests.fromDisk()} from disk) at zoom ${options.terrainZoom}.`,
  )
  return surveyedGradients
}

interface AuditRow {
  edh_milestones: number
  vici_milestones: number
  vici_road_sites: number
  certain_ends: number
  steepest_gradient_percent: number | null
}

const report = async (surveyedGradients: number[]): Promise<void> => {
  const rows = await sql<AuditRow[]>`
    SELECT edh_milestones, vici_milestones, vici_road_sites, certain_ends,
           steepest_gradient_percent::float AS steepest_gradient_percent
    FROM road_audit_segments
  `
  const totals = summariseRoadAudit(
    rows.map((row) => ({
      evidence: {
        edhMilestones: row.edh_milestones,
        viciMilestones: row.vici_milestones,
        viciRoadSites: row.vici_road_sites,
        certainEnds: row.certain_ends,
        steepestGradientPercent: row.steepest_gradient_percent,
      },
    })),
  )
  const [gaps] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM road_audit_gaps`
  const endsMeeting = rows.filter((row) => row.certain_ends > 0).length

  console.log(`Audited ${totals.segments} conjectured and hypothetical segments:`)
  console.log(
    `  with a milestone or road record within ${ROAD_AUDIT_BUFFER_METRES} m: ${totals.supported}`,
  )
  console.log(`  with none: ${totals.unsupported}`)
  console.log(`  continuing a surveyed segment at an end: ${endsMeeting}`)
  console.log(
    `  steeper than ${ROAD_AUDIT_STEEP_GRADIENT_PERCENT}% over ${ROAD_AUDIT_GRADIENT_WINDOW_METRES} m: ${totals.steep} (${totals.steepAndUnsupported} with nothing near)`,
  )
  console.log(`  no gradient read: ${totals.withoutGradient}`)
  console.log(
    `Milestones farther than ${ROAD_GAP_DISTANCE_METRES} m from every road: ${gaps?.count ?? 0}`,
  )

  if (surveyedGradients.length > 0) {
    const p95 = percentileOf(surveyedGradients, 0.95)
    const p99 = percentileOf(surveyedGradients, 0.99)
    console.log(
      `Surveyed segments (${surveyedGradients.length}), steepest ${ROAD_AUDIT_GRADIENT_WINDOW_METRES} m: 95th percentile ${p95?.toFixed(1)}%, 99th ${p99?.toFixed(1)}%` +
        ` — the parameter is ${ROAD_AUDIT_STEEP_GRADIENT_PERCENT}%; it is meant to sit at the 99th.`,
    )
  }
}

const main = async (): Promise<void> => {
  const options = readOptions(process.argv.slice(2))

  console.log('Counting what stands near each segment…')
  await writeCounts()

  const surveyedGradients = options.withSlope ? await writeGradients(options) : []
  await report(surveyedGradients)

  await refreshAtlasCache(['reference:road-audit:*'])
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end())
