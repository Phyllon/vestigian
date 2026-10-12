import type {
  CompassPoint,
  LonLat,
  SightlineVariant,
  TowerRaySection,
  TowerSightlines,
} from '../types'
import { COMPASS_POINTS } from '../types'
import { cellsOfGrid, farthestSeenBySector, seenRuns, wedgeRing } from './seen-grid'
import { buildSightlinePolygon, destinationPoint } from './sightline'

/**
 * A tower's answer turned into things to draw on the map — rings, wedges, the
 * outline, numbers at their places — without MapLibre in sight, so the figures
 * written on the map are tested as figures.
 */

/** Which of the two relations is on show: what the tower sees, or where it is seen from. */
export type SightlineMode = 'view' | 'seenFrom'

/** The distances the rings are drawn at, on the map and on the diagram. */
export const SIGHTLINE_RING_METRES = [500, 1_000, 2_000, 5_000, 10_000] as const

/** The bearing along which ring labels sit — in the gap between the east and south-east spokes. */
const RING_LABEL_BEARING = 112.5

export interface OverlayText {
  /** "640 m", "1.5 km" — in the reader's language and decimal convention. */
  distance: (metres: number) => string
  /** "NE", "NO" — the short compass name. */
  compassShort: (point: CompassPoint) => string
  /** The label at the farthest ground seen. */
  farthest: (metres: number) => string
}

export interface OverlayLabel {
  position: LonLat
  text: string
  /** Spokes first, then rings, then the far point — the order collisions are settled in. */
  role: 'spoke' | 'ring' | 'farthest'
}

export interface SightlineMapGeometry {
  /** The unbroken view, one ring per assumed height. Empty in `seenFrom` mode. */
  outlines: Record<SightlineVariant, [number, number][]> | null
  /** Closed rings of ground seen, one per run of seen cells. */
  seenRings: [number, number][][]
  distanceCircles: { radiusMetres: number; ring: [number, number][] }[]
  labels: OverlayLabel[]
}

const circleRing = (origin: LonLat, radiusMetres: number): [number, number][] => {
  const steps = 96
  const ring: [number, number][] = []
  for (let step = 0; step <= steps; step++) {
    const point = destinationPoint(origin, (step * 360) / steps, radiusMetres)
    ring.push([Math.round(point.lon * 1e5) / 1e5, Math.round(point.lat * 1e5) / 1e5])
  }
  return ring
}

const BEARING_OF: Record<CompassPoint, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
}

/**
 * Everything the map draws for a tower, in one mode.
 *
 * Numbers sit where the thing they measure ends: at each of the eight spokes the
 * open distance (view) or the farthest ground the tower can be seen from
 * (seenFrom), on each ring its distance, at the farthest ground seen its own
 * label. A spoke label never sits closer than 40 m to the tower, or it would
 * stack on the mark.
 */
export const buildSightlineMapGeometry = (
  sightlines: TowerSightlines,
  mode: SightlineMode,
  text: OverlayText,
): SightlineMapGeometry => {
  const origin = sightlines.position
  const grid = mode === 'view' ? sightlines.viewGrid : sightlines.seenFrom.grid
  const cells = cellsOfGrid(grid)
  const shape = { columns: grid.columns, binMetres: grid.binMetres }

  const seenRings = seenRuns(cells, grid).map((run) => wedgeRing(origin, run, shape))
  const labels: OverlayLabel[] = []

  const central = sightlines.variants.central
  const rayCount = central.unbrokenMetres.length
  const farthestBySector = farthestSeenBySector(cells, grid)

  for (const compass of COMPASS_POINTS) {
    const bearing = BEARING_OF[compass]
    const metres =
      mode === 'view'
        ? (central.unbrokenMetres[Math.round((bearing * rayCount) / 360) % rayCount] ?? 0)
        : farthestBySector[compass]
    if (metres <= 0) continue
    labels.push({
      position: destinationPoint(origin, bearing, Math.max(metres, 40)),
      text: `${text.compassShort(compass)} ${text.distance(metres)}`,
      role: 'spoke',
    })
  }

  for (const radiusMetres of SIGHTLINE_RING_METRES) {
    labels.push({
      position: destinationPoint(origin, RING_LABEL_BEARING, radiusMetres),
      text: text.distance(radiusMetres),
      role: 'ring',
    })
  }

  const far = mode === 'view' ? central.farthestVisible : sightlines.seenFrom.farthestVisible
  if (far.metres > 0) {
    labels.push({
      position: destinationPoint(origin, far.bearing, far.metres),
      text: text.farthest(far.metres),
      role: 'farthest',
    })
  }

  let outlines: SightlineMapGeometry['outlines'] = null
  if (mode === 'view') {
    outlines = {
      low: buildSightlinePolygon(origin, sightlines.variants.low.unbrokenMetres),
      central: buildSightlinePolygon(origin, central.unbrokenMetres),
      high: buildSightlinePolygon(origin, sightlines.variants.high.unbrokenMetres),
    }
  }

  return {
    outlines,
    seenRings,
    distanceCircles: SIGHTLINE_RING_METRES.map((radiusMetres) => ({
      radiusMetres,
      ring: circleRing(origin, radiusMetres),
    })),
    labels,
  }
}

export interface RayLine {
  coordinates: [[number, number], [number, number]]
  isSeen: boolean
}

/** One compass line as map segments, seen stretches apart from hidden ones. */
export const buildRayLines = (origin: LonLat, ray: TowerRaySection): RayLine[] =>
  ray.segments.map((segment) => {
    const from = destinationPoint(origin, ray.bearing, segment.fromMetres)
    const to = destinationPoint(origin, ray.bearing, segment.toMetres)
    return {
      coordinates: [
        [Math.round(from.lon * 1e5) / 1e5, Math.round(from.lat * 1e5) / 1e5],
        [Math.round(to.lon * 1e5) / 1e5, Math.round(to.lat * 1e5) / 1e5],
      ],
      isSeen: segment.isSeen,
    }
  })
