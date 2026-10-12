import type { ElevationProfile } from '#shared/types'
import {
  fillElevationGaps,
  samplePolyline,
  summariseElevationProfile,
} from '#shared/utils/elevation-profile'
import { loadTerrainField } from './terrain'

/**
 * The relief along a drawn line: a road's climb, an aqueduct's fall, a wall's
 * course over a ridge. Samples the geometry at an even spacing, reads the terrain
 * under each, and states the totals. Geometry and statistics are
 * `shared/utils/elevation-profile.ts`; this is the part that reads a record and
 * a terrain model. See `.claude/rules/sightlines.md`.
 */

/**
 * Part of the cache key in `server/api/tracings/[id]/profile.get.ts`: change how
 * a profile is sampled or summarised and bump this, or the old answer is served
 * for a week.
 */
export const PROFILE_MODEL_VERSION = 2

/** Finest spacing, and the most samples a profile carries however long the line. */
export const PROFILE_MINIMUM_STEP_METRES = 25
export const PROFILE_MAXIMUM_SAMPLES = 600

interface LineRow {
  geometry: string
}

type LinePart = [number, number][]

/** The parts of a line, or null for anything that is not one (an area, a point). */
const readLineParts = (geometryJson: string): LinePart[] | null => {
  const geometry = JSON.parse(geometryJson) as { type: string; coordinates: unknown }
  if (geometry.type === 'LineString') return [geometry.coordinates as LinePart]
  if (geometry.type === 'MultiLineString') return geometry.coordinates as LinePart[]
  return null
}

export interface ElevationProfileRequest {
  tracingId: number
  /** `public.basemap.terrainUrl`; empty means Mapterhorn's own tiles. */
  terrainUrl: string
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Null when the tracing is not an approved line. Throws a 503 when not one tile
 * could be read — a profile of nothing is not a profile.
 */
export const computeElevationProfile = async (
  request: ElevationProfileRequest,
): Promise<ElevationProfile | null> => {
  const sql = useSql()
  const [row] = await sql<LineRow[]>`
    SELECT ST_AsGeoJSON(ST_LineMerge(geom)) AS geometry
    FROM tracings
    WHERE id = ${request.tracingId} AND status = 'approved' AND kind = 'line'
    LIMIT 1
  `
  if (!row) return null

  const parts = readLineParts(row.geometry)
  if (!parts || parts.every((part) => part.length < 2)) return null

  const { samples, breaks, lengthMetres } = samplePolyline({
    parts,
    minimumStepMetres: PROFILE_MINIMUM_STEP_METRES,
    maximumSamples: PROFILE_MAXIMUM_SAMPLES,
  })

  const field = await loadTerrainField({
    area: { positions: samples.map((sample) => sample.position) },
    terrainUrl: request.terrainUrl,
  })

  const readings = samples.map((sample) =>
    field.elevationAt(sample.position.lon, sample.position.lat),
  )
  const { elevations, coverage } = fillElevationGaps(readings)

  if (coverage === 0) {
    throw createError({
      statusCode: 503,
      message: 'The terrain under this line could not be read.',
    })
  }

  const distances = samples.map((sample) => Math.round(sample.distanceMetres))
  const stats = summariseElevationProfile({ distances, elevations })

  return {
    tracingId: request.tracingId,
    distances,
    elevations: elevations.map((metres) => roundTo(metres, 1)),
    path: samples.map((sample) => [
      roundTo(sample.position.lon, 5),
      roundTo(sample.position.lat, 5),
    ]),
    breaks,
    stats: { ...stats, lengthMetres: Math.round(lengthMetres) },
    terrainCoverage: roundTo(coverage, 3),
  }
}
