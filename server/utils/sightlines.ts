import type {
  BoundingBox,
  CompassPoint,
  LonLat,
  SightlineVariant,
  TowerNeighbourSight,
  TowerRaySection,
  TowerSightlineVariant,
  TowerSightlines,
} from '#shared/types'
import { SIGHTLINE_VARIANTS } from '#shared/types'
import {
  SEEN_GRID_BIN_METRES,
  SEEN_GRID_COLUMNS,
  SIGHTLINE_NEIGHBOUR_LIMIT,
  SIGHTLINE_NEIGHBOUR_RADIUS_METRES,
  SIGHTLINE_RADIUS_METRES,
  SIGHTLINE_RAY_COUNT,
  SIGHTLINE_STEP_METRES,
  TOWER_HEIGHT_MODEL,
  castSightlines,
  describeRay,
  initialBearingDegrees,
  isBareEarthLikely,
  longestUnbroken,
  summariseSectors,
  towerEyeHeights,
  towerTopHeights,
  traceRay,
  traceSightLine,
} from '#shared/utils/sightline'
import type { ObserverCast, SightObserver } from '#shared/utils/sightline'
import { seenGridFromCells } from '#shared/utils/seen-grid'
import { loadTerrainField } from './terrain'

/**
 * Line of sight from a frontier tower, assembled: which sites count as towers,
 * which other towers are close enough to be signalled to, and the terrain under
 * both. The geometry itself is `shared/utils/sightline.ts`.
 * See `.claude/rules/sightlines.md`.
 */

/**
 * A watchtower record counts as a frontier tower when it stands this close to a
 * limes sector. The vici import files 6,914 sites as `watchtower` and 5,720 of
 * them are Sardinian nuraghi; "tower" alone would calculate a Roman guard
 * platform for a Bronze Age one.
 */
export const TOWER_FRONTIER_REACH_METRES = 1_500

interface TowerRow {
  id: number
  slug: string
  title: string
  lon: number
  lat: number
  country_code: string | null
  sector_slug: string
  sector_name: string
}

interface NeighbourRow {
  id: number
  slug: string
  title: string
  lon: number
  lat: number
}

/** The tower, if this site is a watchtower on the frontier; null otherwise. */
export const findFrontierTower = async (siteId: number): Promise<TowerRow | null> => {
  const sql = useSql()
  const [row] = await sql<TowerRow[]>`
    SELECT s.id, s.slug, s.title,
           ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
           s.country_code,
           sector.slug AS sector_slug, sector.name AS sector_name
    FROM sites s
    CROSS JOIN LATERAL (
      SELECT ls.slug, ls.name,
             ST_Distance(ls.geom::geography, s.geom::geography) AS distance
      FROM limes_sectors ls
      WHERE ls.bbox && ST_Expand(s.geom, 0.1)
      ORDER BY distance
      LIMIT 1
    ) AS sector
    WHERE s.id = ${siteId}
      AND s.status = 'approved'
      AND s.subcategory = 'watchtower'
      AND sector.distance <= ${TOWER_FRONTIER_REACH_METRES}
    LIMIT 1
  `
  return row ?? null
}

const findNeighbourTowers = async (tower: TowerRow): Promise<NeighbourRow[]> => {
  const sql = useSql()
  return sql<NeighbourRow[]>`
    SELECT n.id, n.slug, n.title, ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat
    FROM sites n
    JOIN sites o ON o.id = ${tower.id}
    WHERE n.id <> o.id
      AND n.status = 'approved'
      AND n.subcategory = 'watchtower'
      AND n.geom && ST_Expand(o.geom, 0.1)
      AND ST_DWithin(n.geom::geography, o.geom::geography, ${SIGHTLINE_NEIGHBOUR_RADIUS_METRES})
    ORDER BY ST_Distance(n.geom::geography, o.geom::geography)
    LIMIT ${SIGHTLINE_NEIGHBOUR_LIMIT}
  `
}

const METRES_PER_DEGREE_LATITUDE = 111_320

const boundsAround = (centre: LonLat, radiusMetres: number): BoundingBox => {
  const deltaLatitude = radiusMetres / METRES_PER_DEGREE_LATITUDE
  const deltaLongitude = deltaLatitude / Math.max(Math.cos((centre.lat * Math.PI) / 180), 0.2)
  return {
    west: centre.lon - deltaLongitude,
    east: centre.lon + deltaLongitude,
    south: centre.lat - deltaLatitude,
    north: centre.lat + deltaLatitude,
  }
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const SQUARE_METRES_PER_SQUARE_KM = 1_000_000

const roundReach = (reach: { metres: number; bearing: number }) => ({
  metres: Math.round(reach.metres / 10) * 10,
  bearing: Math.round(reach.bearing),
})

const SEEN_GRID_BIN_COUNT = SIGHTLINE_RADIUS_METRES / SEEN_GRID_BIN_METRES

/**
 * Every pair of eyes the tower's answer needs, in one walk over the terrain:
 * the sentry at each of three platform heights looking at a standing person, and
 * — the same relation read the other way — a person on the ground looking at the
 * tower's top at each of three overall heights. Line of sight is symmetric, so
 * "from where could this tower be seen" is a view *from* the tower's top *to* the
 * person's eye, and costs one more column of comparisons, not another walk.
 */
const buildObservers = (): SightObserver[] => {
  const eyes = towerEyeHeights()
  const tops = towerTopHeights()
  const observers: SightObserver[] = []

  for (const variant of SIGHTLINE_VARIANTS) {
    observers.push({
      id: `view-${variant}`,
      eyeHeightMetres: eyes[variant],
      targetHeightMetres: TOWER_HEIGHT_MODEL.targetHeightMetres,
      keepGrid: variant === 'central',
    })
  }
  for (const variant of SIGHTLINE_VARIANTS) {
    observers.push({
      id: `seen-${variant}`,
      eyeHeightMetres: tops[variant],
      targetHeightMetres: TOWER_HEIGHT_MODEL.onlookerEyeMetres,
      keepGrid: variant === 'central',
    })
  }
  return observers
}

const requireCast = (observers: Record<string, ObserverCast>, id: string): ObserverCast =>
  observers[id]!

export interface TowerSightlinesRequest {
  siteId: number
  /** `public.basemap.terrainUrl`; empty means Mapterhorn's own tiles. */
  terrainUrl: string
}

/**
 * Null when the site is not a frontier tower — an ordinary answer, cached like any
 * other. A 503 when the elevation tiles cannot be read, because "we could not see"
 * must not be stored as "there is nothing to see".
 */
export const computeTowerSightlines = async (
  request: TowerSightlinesRequest,
): Promise<TowerSightlines | null> => {
  const tower = await findFrontierTower(request.siteId)
  if (!tower) return null

  const position: LonLat = { lon: tower.lon, lat: tower.lat }
  const neighbourRows = await findNeighbourTowers(tower)

  const field = await loadTerrainField({
    area: { bounds: boundsAround(position, SIGHTLINE_RADIUS_METRES + 300) },
    terrainUrl: request.terrainUrl,
  })

  const groundElevation = field.elevationAt(position.lon, position.lat)
  if (groundElevation === null) {
    throw createError({
      statusCode: 503,
      message: 'The terrain under this tower could not be read.',
    })
  }

  const eyeHeights = towerEyeHeights()
  const towerTops = towerTopHeights()
  const gridShape = {
    columns: SEEN_GRID_COLUMNS,
    binMetres: SEEN_GRID_BIN_METRES,
    binCount: SEEN_GRID_BIN_COUNT,
  }

  const cast = castSightlines({
    origin: position,
    originElevationMetres: groundElevation,
    observers: buildObservers(),
    radiusMetres: SIGHTLINE_RADIUS_METRES,
    rayCount: SIGHTLINE_RAY_COUNT,
    stepMetres: SIGHTLINE_STEP_METRES,
    sampler: field.elevationAt,
    grid: gridShape,
  })

  const variants = {} as Record<SightlineVariant, TowerSightlineVariant>
  const seenFromArea = {} as Record<SightlineVariant, number>
  for (const variant of SIGHTLINE_VARIANTS) {
    const result = requireCast(cast.observers, `view-${variant}`)
    // Ten metres is finer than the terrain model's own pixel, and keeps the answer small.
    const unbroken = result.unbrokenMetres.map((metres) => Math.round(metres / 10) * 10)
    variants[variant] = {
      eyeHeightMetres: eyeHeights[variant],
      unbrokenMetres: unbroken,
      unbrokenAreaSquareKm: roundTo(
        result.unbrokenAreaSquareMetres / SQUARE_METRES_PER_SQUARE_KM,
        1,
      ),
      visibleAreaSquareKm: roundTo(result.visibleAreaSquareMetres / SQUARE_METRES_PER_SQUARE_KM, 1),
      longestUnbroken: roundReach(longestUnbroken(unbroken)),
      farthestVisible: roundReach(result.farthestVisible),
      sectors: summariseSectors(unbroken).map((sector) => ({
        ...sector,
        medianMetres: Math.round(sector.medianMetres),
      })),
    }
    seenFromArea[variant] = roundTo(
      requireCast(cast.observers, `seen-${variant}`).visibleAreaSquareMetres /
        SQUARE_METRES_PER_SQUARE_KM,
      1,
    )
  }

  const viewCells = requireCast(cast.observers, 'view-central').seenCells!
  const seenFromCast = requireCast(cast.observers, 'seen-central')

  const neighbours: TowerNeighbourSight[] = []
  for (const row of neighbourRows) {
    const there: LonLat = { lon: row.lon, lat: row.lat }
    const thereElevation = field.elevationAt(there.lon, there.lat)
    if (thereElevation === null) continue

    const isClear = {} as Record<SightlineVariant, boolean>
    let central: ReturnType<typeof traceSightLine> | null = null

    for (const variant of SIGHTLINE_VARIANTS) {
      const trace = traceSightLine({
        from: position,
        to: there,
        fromEyeElevationMetres: groundElevation + eyeHeights[variant],
        toEyeElevationMetres: thereElevation + eyeHeights[variant],
        stepMetres: SIGHTLINE_STEP_METRES,
        sampler: field.elevationAt,
        maximumProfilePoints: 96,
      })
      isClear[variant] = trace.isClear
      if (variant === 'central') central = trace
    }
    if (!central) continue

    neighbours.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      position: there,
      distanceMetres: Math.round(central.distanceMetres),
      bearing: roundTo(initialBearingDegrees(position, there), 0),
      isClear,
      minimumClearanceMetres: central.minimumClearanceMetres,
      tightestAtMetres: central.tightestAtMetres,
      profile: central.profile,
    })
  }

  return {
    siteId: tower.id,
    position,
    groundElevationMetres: Math.round(groundElevation),
    sector: { slug: tower.sector_slug, name: tower.sector_name },
    platformMetres: { ...TOWER_HEIGHT_MODEL.platformMetres },
    eyeAbovePlatformMetres: TOWER_HEIGHT_MODEL.eyeAbovePlatformMetres,
    targetHeightMetres: TOWER_HEIGHT_MODEL.targetHeightMetres,
    radiusMetres: SIGHTLINE_RADIUS_METRES,
    terrainCoverage:
      cast.sampleCount === 0 ? 0 : roundTo(1 - cast.missingSampleCount / cast.sampleCount, 3),
    isBareEarthLikely: isBareEarthLikely(tower.country_code),
    variants,
    viewGrid: seenGridFromCells(viewCells, gridShape),
    seenFrom: {
      towerMetres: towerTops,
      onlookerEyeMetres: TOWER_HEIGHT_MODEL.onlookerEyeMetres,
      visibleAreaSquareKm: seenFromArea,
      farthestVisible: roundReach(seenFromCast.farthestVisible),
      grid: seenGridFromCells(seenFromCast.seenCells!, gridShape),
    },
    neighbours,
  }
}

/** The eight compass lines, as bearings; the only rays an endpoint will answer for. */
export const RAY_BEARINGS: Record<CompassPoint, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
}

/** Coarser than the cast's 15 m: a 400-sample line is what a chart can show. */
const RAY_STEP_METRES = 25

export interface TowerRayRequest {
  siteId: number
  compass: CompassPoint
  terrainUrl: string
}

/**
 * The ground along one compass line out from a tower, against the sentry's eyes
 * at the middle estimate: what is seen, what is hidden, and what does the
 * hiding. Null when the site is not a frontier tower.
 */
export const computeTowerRay = async (
  request: TowerRayRequest,
): Promise<TowerRaySection | null> => {
  const tower = await findFrontierTower(request.siteId)
  if (!tower) return null

  const position: LonLat = { lon: tower.lon, lat: tower.lat }
  const field = await loadTerrainField({
    area: { bounds: boundsAround(position, SIGHTLINE_RADIUS_METRES + 300) },
    terrainUrl: request.terrainUrl,
  })

  const groundElevation = field.elevationAt(position.lon, position.lat)
  if (groundElevation === null) {
    throw createError({
      statusCode: 503,
      message: 'The terrain under this tower could not be read.',
    })
  }

  const bearing = RAY_BEARINGS[request.compass]
  const trace = traceRay({
    origin: position,
    originElevationMetres: groundElevation,
    bearingDegrees: bearing,
    eyeHeightMetres: towerEyeHeights().central,
    targetHeightMetres: TOWER_HEIGHT_MODEL.targetHeightMetres,
    radiusMetres: SIGHTLINE_RADIUS_METRES,
    stepMetres: RAY_STEP_METRES,
    sampler: field.elevationAt,
  })

  return {
    siteId: tower.id,
    compass: request.compass,
    bearing,
    radiusMetres: SIGHTLINE_RADIUS_METRES,
    ...describeRay({
      trace,
      towerGroundMetres: groundElevation,
      stepMetres: RAY_STEP_METRES,
    }),
  }
}
