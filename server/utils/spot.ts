import type { SpotContext, SpotNearestTown, YearSpan } from '#shared/types'
import { mergeYearSpans, snapCoordinate } from '#shared/utils/spot'
import { readElevation } from './terrain'

/**
 * What can be said about a spot from its coordinate alone: the nearest town,
 * the country, the elevation, and the years the Roman state's recorded extent
 * covered it. Behind `GET /api/spot`, which the reference marks' info boxes
 * call when a reader opens "About this spot".
 *
 * Every query filters in 4326 with `geom && …` first — a geography cast cannot
 * use the GiST index, and `.claude/rules/map-and-tiles.md` records what that
 * costs on a table this size.
 */

type Sql = ReturnType<typeof useSql>

/**
 * Past this the nearest town says nothing about where the spot is — in the
 * Libyan desert the closest GeoNames place can be a hundred kilometres away,
 * and "near" would be a lie.
 */
export const MAX_NEAREST_TOWN_METRES = 30_000

/**
 * Natural Earth's 1:50m coastline sits a little inland of the true one, so a
 * harbour can fall just outside every polygon. Within this distance of one is
 * still that country.
 */
export const COASTAL_COUNTRY_TOLERANCE_METRES = 10_000

interface Point {
  lon: number
  lat: number
}

const findNearestTown = async (sql: Sql, point: Point): Promise<SpotNearestTown | null> => {
  const rows = await sql<{ name: string; metres: number }[]>`
    WITH here AS (SELECT ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326) AS g)
    SELECT c.name, ST_Distance(c.geom::geography, here.g::geography) AS metres
    FROM cities c, here
    ORDER BY c.geom <-> here.g
    LIMIT 1
  `
  const town = rows[0]
  if (!town || town.metres > MAX_NEAREST_TOWN_METRES) return null
  return { name: town.name, distanceMetres: Math.round(town.metres) }
}

const findCountryCode = async (sql: Sql, point: Point): Promise<string | null> => {
  const inside = await sql<{ iso_a2: string }[]>`
    WITH here AS (SELECT ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326) AS g)
    SELECT b.iso_a2
    FROM country_boundaries b, here
    WHERE b.geom && here.g AND ST_Intersects(b.geom, here.g)
    LIMIT 1
  `
  if (inside[0]) return inside[0].iso_a2

  // 0.2° is the box that surely contains the tolerance at any latitude this
  // atlas covers; the exact test is the geography distance.
  const nearby = await sql<{ iso_a2: string }[]>`
    WITH here AS (SELECT ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326) AS g)
    SELECT b.iso_a2
    FROM country_boundaries b, here
    WHERE b.geom && ST_Expand(here.g, 0.2)
      AND ST_DWithin(b.geom::geography, here.g::geography, ${COASTAL_COUNTRY_TOLERANCE_METRES})
    ORDER BY ST_Distance(b.geom::geography, here.g::geography)
    LIMIT 1
  `
  return nearby[0]?.iso_a2 ?? null
}

const findExtentSpans = async (sql: Sql, point: Point): Promise<YearSpan[]> => {
  const rows = await sql<{ start_year: number; end_year: number }[]>`
    WITH here AS (SELECT ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326) AS g)
    SELECT e.start_year, e.end_year
    FROM antiquity_empire_extents e, here
    WHERE e.geom && here.g AND ST_Intersects(e.geom, here.g)
  `
  return mergeYearSpans(rows.map((row): YearSpan => [row.start_year, row.end_year]))
}

export interface SpotRequest {
  lon: number
  lat: number
  terrainUrl: string
  /** Called with a short reason when one part fails; the others still answer. */
  onPartFailure?: (part: string, error: unknown) => void
}

/**
 * Each part stands alone: a terrain host that times out must not take the
 * country and the extent down with it, and a reader who is told "elevation
 * unavailable" is better served than one who is told nothing. A part that
 * fails answers as absent (`null`) and is reported to the caller, which logs it.
 */
const orNull = async <T>(
  part: string,
  attempt: () => Promise<T | null>,
  onFailure?: (part: string, error: unknown) => void,
): Promise<T | null> => {
  try {
    return await attempt()
  } catch (error) {
    onFailure?.(part, error)
    return null
  }
}

export const readSpotContext = async (request: SpotRequest): Promise<SpotContext> => {
  // Computed on the snapped point, so a cached answer is a pure function of its key.
  const point: Point = { lon: snapCoordinate(request.lon), lat: snapCoordinate(request.lat) }
  const sql = useSql()
  const { onPartFailure } = request

  const [nearestTown, countryCode, extentSpans, elevationMetres] = await Promise.all([
    orNull('town', () => findNearestTown(sql, point), onPartFailure),
    orNull('country', () => findCountryCode(sql, point), onPartFailure),
    orNull('extent', () => findExtentSpans(sql, point), onPartFailure),
    orNull(
      'elevation',
      () => readElevation({ ...point, terrainUrl: request.terrainUrl }),
      onPartFailure,
    ),
  ])

  return { nearestTown, countryCode, elevationMetres, extentSpans }
}
