import type {
  CompassPoint,
  LonLat,
  RayLandmark,
  RaySegment,
  SightlineReach,
  SightlineSector,
  SightlineVariant,
  TowerRaySection,
  TowerSightProfile,
} from '../types'
import { COMPASS_POINTS } from '../types'

/**
 * Line of sight over bare ground — what a tower's guard platform could have
 * seen, as geometry. Pure functions over an injected elevation sampler, so the
 * server reads terrain tiles and the tests read a few lines of arithmetic.
 * See `.claude/rules/sightlines.md` for what is claimed and what is not.
 */

const EARTH_RADIUS_METRES = 6_371_000

/**
 * How much of the earth's curvature the air gives back. 0.13 is the textbook
 * value for light near the ground in ordinary conditions (geodesy, surveying);
 * it is a mean, not a measurement of any particular day.
 */
export const REFRACTION_COEFFICIENT = 0.13

/**
 * The height model for a Roman frontier tower. **It is an estimate, and the only
 * honest one on offer**: no tower stands to its original height, so every figure
 * is a reconstruction.
 *
 * What the sources agree on, as read on 2026-10-12 (none of it a measurement of an
 * excavated structure):
 *
 * - "usually about 10 m" (limesseiten.de) and "about 10 to 12 m" (gunzenhausen.info)
 *   for the Upper German–Raetian towers — both uncited, both consistent;
 * - the stone replica Wp 3/26 at Idstein-Dasbach, built under the Saalburg
 *   museum's supervision: about 13 m in all, **guard gallery at 8.5 m** (the
 *   article credits that to private measurement);
 * - the Gask Ridge analysis (Woolliscroft; Roman Gask Project) tests "even from a
 *   10 m tower";
 * - English Heritage describes Hadrian's Wall turrets as two or three storeys
 *   with an open parapet or a pitched roof, and one of its school resources
 *   puts them near 10 m.
 *
 * So: a tower about 10 m high, its guard platform about three-quarters of the way
 * up (the rest is parapet and roof), a sentry's eyes 1.6 m above that. The low
 * and high platforms bracket a 9–10 m tower with a deep roof at one end and the
 * Idstein replica's own gallery at the other. Taller claims exist (a 16 m figure
 * is given for a stone tower at Hillscheid); they are left outside the range
 * because nothing cited stands behind them.
 *
 * Change a number here and the cache key's model version (`SIGHTLINE_MODEL_VERSION`)
 * with it, or served answers will keep the old one.
 */
export const TOWER_HEIGHT_MODEL = {
  platformMetres: { low: 6, central: 7.5, high: 8.5 } satisfies Record<SightlineVariant, number>,
  eyeAbovePlatformMetres: 1.6,
  /**
   * The parapet and roof above the guard platform. 8.5 + 2.5 = 11 m puts the
   * high estimate inside the "10 to 12 m" the Bavarian sources give for the whole
   * tower, and 7.5 + 2.5 = 10 m is their "usually about 10 m". Used only for the
   * tower as something to be *seen*; what a sentry sees is measured from the eyes.
   */
  roofAbovePlatformMetres: 2.5,
  /** A standing person; a rider's head is higher, a crouching raider's lower. */
  targetHeightMetres: 1.7,
  /** A person on the ground looking up at the tower. */
  onlookerEyeMetres: 1.6,
} as const

/**
 * Bumped whenever the model, its constants or the shape of the answer changes:
 * it is part of the cache key. 2: seen-cell grids, the reverse view, ray sections;
 * 3: a ray names its longest dead ground, not the first place ground returns.
 */
export const SIGHTLINE_MODEL_VERSION = 3

/** The polar grid the seen ground is kept in: one-degree wedges, hundred-metre bins. */
export const SEEN_GRID_COLUMNS = 360
export const SEEN_GRID_BIN_METRES = 100

/** How far the calculation looks, and how it samples. The radius is a limit of the model, not of the eye. */
export const SIGHTLINE_RADIUS_METRES = 10_000
export const SIGHTLINE_RAY_COUNT = 720
export const SIGHTLINE_STEP_METRES = 15

/** Other towers considered for tower-to-tower sight, nearest first. */
export const SIGHTLINE_NEIGHBOUR_RADIUS_METRES = 5_000
export const SIGHTLINE_NEIGHBOUR_LIMIT = 6

/**
 * Countries whose national surveys appear in Mapterhorn's source catalogue as a
 * bare-earth terrain model (`DGM`, `DTM`, `MNT`, `MDT`, `AHN`…), read from
 * `download.mapterhorn.com/attribution.json` on 2026-10-12. Elsewhere the tiles
 * fall back to Copernicus GLO-30, a **surface** model in which woodland and
 * buildings are part of the ground — and a "no trees" calculation is then a
 * calculation with trees.
 *
 * A judgement from the country, not from the tile: coverage inside a country can
 * be partial (Romania's is a 0.5 m survey of part of the country), and the
 * catalogue changes. It decides only whether a caution is printed.
 */
export const BARE_EARTH_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'LU',
  'LV',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
])

export const isBareEarthLikely = (countryCode: string | null): boolean =>
  countryCode !== null && BARE_EARTH_COUNTRY_CODES.has(countryCode.toUpperCase())

export const towerEyeHeights = (): Record<SightlineVariant, number> => ({
  low: TOWER_HEIGHT_MODEL.platformMetres.low + TOWER_HEIGHT_MODEL.eyeAbovePlatformMetres,
  central: TOWER_HEIGHT_MODEL.platformMetres.central + TOWER_HEIGHT_MODEL.eyeAbovePlatformMetres,
  high: TOWER_HEIGHT_MODEL.platformMetres.high + TOWER_HEIGHT_MODEL.eyeAbovePlatformMetres,
})

/** The overall height of the tower, platform and roof: what a distant onlooker sees the top of. */
export const towerTopHeights = (): Record<SightlineVariant, number> => ({
  low: TOWER_HEIGHT_MODEL.platformMetres.low + TOWER_HEIGHT_MODEL.roofAbovePlatformMetres,
  central: TOWER_HEIGHT_MODEL.platformMetres.central + TOWER_HEIGHT_MODEL.roofAbovePlatformMetres,
  high: TOWER_HEIGHT_MODEL.platformMetres.high + TOWER_HEIGHT_MODEL.roofAbovePlatformMetres,
})

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180
const toDegrees = (radians: number): number => (radians * 180) / Math.PI

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * How far the ground has dropped away from a horizontal line `distanceMetres`
 * out, after refraction. The two-thirds-ish figure surveyors use, not 1/2R.
 */
export const curvatureDropMetres = (distanceMetres: number): number =>
  (distanceMetres * distanceMetres * (1 - REFRACTION_COEFFICIENT)) / (2 * EARTH_RADIUS_METRES)

/** The point reached by going `distanceMetres` along `bearingDegrees` from `origin`, on a sphere. */
export const destinationPoint = (
  origin: LonLat,
  bearingDegrees: number,
  distanceMetres: number,
): LonLat => {
  const angular = distanceMetres / EARTH_RADIUS_METRES
  const bearing = toRadians(bearingDegrees)
  const latitude = toRadians(origin.lat)
  const longitude = toRadians(origin.lon)

  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angular) +
      Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing),
  )
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
      Math.cos(angular) - Math.sin(latitude) * Math.sin(destinationLatitude),
    )

  return { lon: toDegrees(destinationLongitude), lat: toDegrees(destinationLatitude) }
}

/** Degrees clockwise from north, 0–360, of the great-circle course from `from` towards `to`. */
export const initialBearingDegrees = (from: LonLat, to: LonLat): number => {
  const fromLatitude = toRadians(from.lat)
  const toLatitude = toRadians(to.lat)
  const deltaLongitude = toRadians(to.lon - from.lon)
  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude)
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude)
  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

export const compassPointFor = (bearingDegrees: number): CompassPoint => {
  const index = Math.round((((bearingDegrees % 360) + 360) % 360) / 45) % 8
  return COMPASS_POINTS[index]!
}

/** Metres between two points, by the haversine. */
export const distanceMetresBetween = (from: LonLat, to: LonLat): number => {
  const deltaLatitude = toRadians(to.lat - from.lat)
  const deltaLongitude = toRadians(to.lon - from.lon)
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Metres above sea level at a coordinate, or null where there is no terrain under it. */
export type ElevationSampler = (lon: number, lat: number) => number | null

/** One pair of eyes and what they look for. Several share a single walk over the terrain. */
export interface SightObserver {
  /** The key the result is returned under. */
  id: string
  eyeHeightMetres: number
  /** The height above the ground of the thing looked at. */
  targetHeightMetres: number
  /** Also keep which polar cells were seen. */
  keepGrid?: boolean
}

export interface SeenGridShape {
  columns: number
  binMetres: number
  binCount: number
}

export interface CastSightlinesRequest {
  origin: LonLat
  /** The ground at the origin, from the same sampler. */
  originElevationMetres: number
  observers: SightObserver[]
  radiusMetres: number
  rayCount: number
  stepMetres: number
  sampler: ElevationSampler
  /** Required when any observer asks for `keepGrid`. */
  grid?: SeenGridShape
}

export interface ObserverCast {
  unbrokenMetres: number[]
  unbrokenAreaSquareMetres: number
  visibleAreaSquareMetres: number
  farthestVisible: SightlineReach
  /** One byte per polar cell, 1 where seen; present when the observer asked for it. */
  seenCells?: Uint8Array
}

export interface CastSightlinesResult {
  observers: Record<string, ObserverCast>
  sampleCount: number
  missingSampleCount: number
}

interface CellCounts {
  seen: Uint16Array
  total: Uint16Array
}

interface ObserverAccumulator {
  eyeElevation: number
  targetHeight: number
  unbroken: number[]
  unbrokenArea: number
  visibleArea: number
  farthest: SightlineReach
  cells: CellCounts | null
}

/** What one ray has seen so far for one observer. */
interface RayState {
  steepest: number
  isBroken: boolean
}

interface SampleObservation {
  ray: number
  bearingDegrees: number
  distance: number
  /** The terrain at this distance, with the earth's drop already taken off. */
  terrain: number
  stepMetres: number
  /** The area one sample stands for: the ring one step deep, in this ray's wedge. */
  area: number
  /** The cell this sample falls in, or -1 when no grid is kept. */
  cell: number
}

/**
 * One terrain sample against the steepest rise so far on this ray. A point is
 * seen when its top clears that angle; the ground's own angle then becomes the
 * new steepest, so the comparison always runs against what came before it.
 */
const observeSample = (
  accumulator: ObserverAccumulator,
  state: RayState,
  sample: SampleObservation,
): void => {
  const topAngle =
    (sample.terrain + accumulator.targetHeight - accumulator.eyeElevation) / sample.distance
  const isSeen = topAngle >= state.steepest

  if (isSeen) {
    accumulator.visibleArea += sample.area
    if (!state.isBroken) accumulator.unbrokenArea += sample.area
    if (sample.distance > accumulator.farthest.metres) {
      accumulator.farthest = { metres: sample.distance, bearing: sample.bearingDegrees }
    }
  } else if (!state.isBroken) {
    state.isBroken = true
    accumulator.unbroken[sample.ray] = sample.distance - sample.stepMetres
  }

  if (accumulator.cells && sample.cell >= 0) {
    accumulator.cells.total[sample.cell]!++
    if (isSeen) accumulator.cells.seen[sample.cell]!++
  }

  const groundAngle = (sample.terrain - accumulator.eyeElevation) / sample.distance
  if (groundAngle > state.steepest) state.steepest = groundAngle
}

interface RayCounts {
  samples: number
  missing: number
}

const METRES_PER_DEGREE_LATITUDE = (EARTH_RADIUS_METRES * Math.PI) / 180

/**
 * Where a point `step` strides along a ray lies, by a local flat-earth offset —
 * good to a few metres at ten kilometres, and the same arithmetic in the cast and
 * in the ray section, so the two cannot disagree about which ground a sample is.
 */
const rayPosition = (
  origin: LonLat,
  bearingRadians: number,
  distanceMetres: number,
): [number, number] => {
  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos(toRadians(origin.lat))
  return [
    origin.lon + (Math.sin(bearingRadians) * distanceMetres) / metresPerDegreeLongitude,
    origin.lat + (Math.cos(bearingRadians) * distanceMetres) / METRES_PER_DEGREE_LATITUDE,
  ]
}

/** Walks one ray outward for every observer at once, stopping where the terrain data does. */
const castRay = (
  request: CastSightlinesRequest,
  ray: number,
  accumulators: ObserverAccumulator[],
): RayCounts => {
  const { origin, radiusMetres, rayCount, stepMetres, sampler, grid } = request
  const angleStep = (2 * Math.PI) / rayCount
  const bearingRadians = ray * angleStep
  const bearingDegrees = toDegrees(bearingRadians)
  const states: RayState[] = accumulators.map(() => ({
    steepest: Number.NEGATIVE_INFINITY,
    isBroken: false,
  }))

  const column = grid ? Math.floor((ray * grid.columns) / rayCount) : -1
  const stepCount = Math.floor(radiusMetres / stepMetres)
  const counts: RayCounts = { samples: 0, missing: 0 }

  for (let step = 1; step <= stepCount; step++) {
    const distance = step * stepMetres
    const [lon, lat] = rayPosition(origin, bearingRadians, distance)
    const elevation = sampler(lon, lat)
    counts.samples++

    if (elevation === null) {
      counts.missing++
      // Whatever had not broken by here ends at the last ground that was measured.
      accumulators.forEach((accumulator, index) => {
        if (!states[index]!.isBroken) accumulator.unbroken[ray] = distance - stepMetres
      })
      break
    }

    let cell = -1
    if (grid) {
      const bin = Math.min(grid.binCount - 1, Math.floor((distance - 0.001) / grid.binMetres))
      cell = column * grid.binCount + bin
    }

    const sample: SampleObservation = {
      ray,
      bearingDegrees,
      distance,
      terrain: elevation - curvatureDropMetres(distance),
      stepMetres,
      area: distance * stepMetres * angleStep,
      cell,
    }
    accumulators.forEach((accumulator, index) => observeSample(accumulator, states[index]!, sample))
  }

  return counts
}

/**
 * Casts rays outward from the tower and, along each, keeps the steepest angle the
 * ground has risen to so far. A point is seen when its top clears that angle.
 *
 * Every observer shares one walk over the terrain — the samples are the expensive
 * part, the comparison is not. The curvature drop is taken off the terrain, not
 * added to the eye, so every point is compared on the same horizontal.
 *
 * "Unbroken" is the distance to the first point not seen, which draws as one
 * shape round the tower. Ground that comes back into view beyond a rise is not
 * in that shape but is counted in `visibleAreaSquareMetres`, in `farthestVisible`
 * and in the polar cells: a reader asking how far a sentry could see wants both.
 * A cell is called seen when at least half the samples that fell in it were.
 *
 * A ray that runs off the edge of the terrain data stops there: nothing is
 * claimed about ground that was not measured.
 */
export const castSightlines = (request: CastSightlinesRequest): CastSightlinesResult => {
  const cellTotal = request.grid ? request.grid.columns * request.grid.binCount : 0

  const accumulators: ObserverAccumulator[] = request.observers.map((observer) => ({
    eyeElevation: request.originElevationMetres + observer.eyeHeightMetres,
    targetHeight: observer.targetHeightMetres,
    unbroken: new Array<number>(request.rayCount).fill(request.radiusMetres),
    unbrokenArea: 0,
    visibleArea: 0,
    farthest: { metres: 0, bearing: 0 },
    cells:
      observer.keepGrid && request.grid
        ? { seen: new Uint16Array(cellTotal), total: new Uint16Array(cellTotal) }
        : null,
  }))

  let sampleCount = 0
  let missingSampleCount = 0
  for (let ray = 0; ray < request.rayCount; ray++) {
    const counts = castRay(request, ray, accumulators)
    sampleCount += counts.samples
    missingSampleCount += counts.missing
  }

  const observers: Record<string, ObserverCast> = {}
  request.observers.forEach((observer, index) => {
    const accumulator = accumulators[index]!
    const cast: ObserverCast = {
      unbrokenMetres: accumulator.unbroken,
      unbrokenAreaSquareMetres: accumulator.unbrokenArea,
      visibleAreaSquareMetres: accumulator.visibleArea,
      farthestVisible: accumulator.farthest,
    }
    if (accumulator.cells) {
      const { seen, total } = accumulator.cells
      cast.seenCells = Uint8Array.from(seen, (count, cell) =>
        total[cell]! > 0 && count * 2 >= total[cell]! ? 1 : 0,
      )
    }
    observers[observer.id] = cast
  })

  return { observers, sampleCount, missingSampleCount }
}

export interface TraceRayRequest {
  origin: LonLat
  originElevationMetres: number
  bearingDegrees: number
  eyeHeightMetres: number
  targetHeightMetres: number
  radiusMetres: number
  stepMetres: number
  sampler: ElevationSampler
}

export interface RayTrace {
  distances: number[]
  /** Raw terrain, metres above sea level, without the earth's drop. */
  ground: number[]
  isSeen: boolean[]
  eyeElevationMetres: number
  /** True when the data ran out before the radius. */
  isIncomplete: boolean
}

/**
 * One compass line, sample by sample, with the same arithmetic as the cast —
 * the explanation of why a ray ends where it does must be the calculation, not
 * a second opinion of it.
 */
export const traceRay = (request: TraceRayRequest): RayTrace => {
  const { origin, bearingDegrees, radiusMetres, stepMetres, sampler } = request
  const bearingRadians = toRadians(bearingDegrees)
  const eyeElevationMetres = request.originElevationMetres + request.eyeHeightMetres
  const stepCount = Math.floor(radiusMetres / stepMetres)

  const distances: number[] = []
  const ground: number[] = []
  const isSeen: boolean[] = []
  let steepest = Number.NEGATIVE_INFINITY
  let isIncomplete = false

  for (let step = 1; step <= stepCount; step++) {
    const distance = step * stepMetres
    const [lon, lat] = rayPosition(origin, bearingRadians, distance)
    const elevation = sampler(lon, lat)
    if (elevation === null) {
      isIncomplete = true
      break
    }

    const terrain = elevation - curvatureDropMetres(distance)
    const topAngle = (terrain + request.targetHeightMetres - eyeElevationMetres) / distance
    distances.push(distance)
    ground.push(roundTo(elevation, 1))
    isSeen.push(topAngle >= steepest)

    const groundAngle = (terrain - eyeElevationMetres) / distance
    if (groundAngle > steepest) steepest = groundAngle
  }

  return { distances, ground, isSeen, eyeElevationMetres, isIncomplete }
}

const landmarkAt = (trace: RayTrace, index: number, towerGroundMetres: number): RayLandmark => ({
  atMetres: trace.distances[index]!,
  groundMetres: trace.ground[index]!,
  aboveTowerGroundMetres: roundTo(trace.ground[index]! - towerGroundMetres, 1),
  aboveEyeMetres: roundTo(trace.ground[index]! - trace.eyeElevationMetres, 1),
})

/** Runs of consecutive samples that are all seen, or all hidden. */
const segmentsOf = (trace: RayTrace, stepMetres: number): RaySegment[] => {
  const segments: RaySegment[] = []
  trace.isSeen.forEach((isSeen, index) => {
    const last = segments[segments.length - 1]
    const toMetres = trace.distances[index]!
    if (last && last.isSeen === isSeen) {
      last.toMetres = toMetres
    } else {
      segments.push({ fromMetres: toMetres - stepMetres, toMetres, isSeen })
    }
  })
  return segments
}

export interface DescribeRayRequest {
  trace: RayTrace
  towerGroundMetres: number
  stepMetres: number
}

/** The sample with the steepest angle from the eyes among those before `limit`. */
const steepestBefore = (trace: RayTrace, limit: number): number => {
  let best = 0
  let bestAngle = Number.NEGATIVE_INFINITY
  for (let index = 0; index < limit; index++) {
    const distance = trace.distances[index]!
    const angle =
      (trace.ground[index]! - curvatureDropMetres(distance) - trace.eyeElevationMetres) / distance
    if (angle > bestAngle) {
      bestAngle = angle
      best = index
    }
  }
  return best
}

interface SampleRun {
  start: number
  /** One past the last sample of the run. */
  end: number
  isSeen: boolean
}

const runsOf = (isSeen: readonly boolean[]): SampleRun[] => {
  const runs: SampleRun[] = []
  isSeen.forEach((seen, index) => {
    const last = runs[runs.length - 1]
    if (last && last.isSeen === seen) {
      last.end = index + 1
    } else {
      runs.push({ start: index, end: index + 1, isSeen: seen })
    }
  })
  return runs
}

/**
 * What stands in the way on one line, in the plainest terms the numbers allow:
 * the crest that ends the unbroken view (the steepest rise before the first
 * hidden sample — not the first hidden sample itself, which is merely behind
 * it); the longest hidden stretch, the crest that throws it into shadow and
 * where ground returns to view beyond it; and how much of the line is dead
 * ground short of the farthest ground seen.
 *
 * The first block and the longest shadow are not always the same crest. A line
 * over a rim has a hummock a hundred metres out that hides ten metres of ground
 * and a valley behind the rim that hides a kilometre; the second is what a
 * reader asking "what is shrinking its view" is after.
 */
export const describeRay = (
  request: DescribeRayRequest,
): Omit<TowerRaySection, 'siteId' | 'compass' | 'bearing' | 'radiusMetres'> => {
  const { trace, towerGroundMetres, stepMetres } = request
  const count = trace.distances.length

  const firstHidden = trace.isSeen.indexOf(false)
  // `steepestBefore(…, 0)` is sample 0: hidden at the very first step, the nearest
  // ground is what blocks.
  let firstBlock: RayLandmark | null = null
  if (firstHidden >= 0) {
    firstBlock = landmarkAt(trace, steepestBefore(trace, firstHidden), towerGroundMetres)
  }

  const hiddenRuns = runsOf(trace.isSeen).filter((run) => !run.isSeen)
  let longest: SampleRun | null = null
  hiddenRuns.forEach((run) => {
    if (!longest || run.end - run.start > longest.end - longest.start) longest = run
  })

  let deadGround: TowerRaySection['deadGround'] = null
  if (longest) {
    const run: SampleRun = longest
    deadGround = {
      fromMetres: trace.distances[run.start]! - stepMetres,
      toMetres: trace.distances[run.end - 1]!,
      crest: landmarkAt(trace, steepestBefore(trace, run.start), towerGroundMetres),
      reappearsAt: run.end < count ? landmarkAt(trace, run.end, towerGroundMetres) : null,
    }
  }

  let highest = 0
  trace.ground.forEach((metres, index) => {
    if (metres > trace.ground[highest]!) highest = index
  })

  const lastSeen = trace.isSeen.lastIndexOf(true)
  const seenCount = trace.isSeen.filter(Boolean).length
  const hiddenShort = lastSeen < 0 ? 0 : trace.isSeen.slice(0, lastSeen).filter((v) => !v).length

  return {
    groundElevationMetres: roundTo(towerGroundMetres, 0),
    eyeElevationMetres: roundTo(trace.eyeElevationMetres, 1),
    distances: trace.distances,
    ground: trace.ground,
    segments: segmentsOf(trace, stepMetres),
    firstBlock,
    deadGround,
    highest: landmarkAt(trace, Math.max(0, Math.min(highest, count - 1)), towerGroundMetres),
    seenMetres: seenCount * stepMetres,
    hiddenMetres: hiddenShort * stepMetres,
    farthestSeenMetres: lastSeen < 0 ? 0 : trace.distances[lastSeen]!,
  }
}

/** The longest unbroken run and the bearing it points along. */
export const longestUnbroken = (unbrokenMetres: readonly number[]): SightlineReach => {
  let best = 0
  for (let ray = 1; ray < unbrokenMetres.length; ray++) {
    if (unbrokenMetres[ray]! > unbrokenMetres[best]!) best = ray
  }
  return {
    metres: unbrokenMetres[best] ?? 0,
    bearing: (best * 360) / Math.max(unbrokenMetres.length, 1),
  }
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return 0
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * The view told as eight compass sectors, which is how it is read aloud: how far
 * the middle of the sector saw, and where it was narrowest.
 */
export const summariseSectors = (unbrokenMetres: readonly number[]): SightlineSector[] => {
  const rayCount = unbrokenMetres.length
  const buckets = COMPASS_POINTS.map(() => [] as number[])

  for (let ray = 0; ray < rayCount; ray++) {
    const bearing = (ray * 360) / rayCount
    const compass = compassPointFor(bearing)
    buckets[COMPASS_POINTS.indexOf(compass)]!.push(unbrokenMetres[ray]!)
  }

  return COMPASS_POINTS.map((compass, index) => {
    const values = buckets[index]!
    return {
      compass,
      medianMetres: median(values),
      shortestMetres: values.length === 0 ? 0 : Math.min(...values),
    }
  })
}

/** The unbroken view as one closed ring, ready for a GeoJSON polygon. */
export const buildSightlinePolygon = (
  origin: LonLat,
  unbrokenMetres: readonly number[],
): [number, number][] => {
  const rayCount = unbrokenMetres.length
  const ring = unbrokenMetres.map((metres, ray) => {
    const point = destinationPoint(origin, (ray * 360) / rayCount, metres)
    return [roundTo(point.lon, 5), roundTo(point.lat, 5)] as [number, number]
  })
  return [...ring, ring[0]!]
}

const decimateProfile = (
  profile: TowerSightProfile,
  request: Pick<TraceSightLineRequest, 'maximumProfilePoints'>,
): TowerSightProfile => {
  const length = profile.distances.length
  if (length <= request.maximumProfilePoints) return profile

  const stride = Math.ceil(length / request.maximumProfilePoints)
  const indexes: number[] = []
  for (let index = 0; index < length; index += stride) indexes.push(index)
  if (indexes[indexes.length - 1] !== length - 1) indexes.push(length - 1)

  return {
    distances: indexes.map((index) => profile.distances[index]!),
    terrain: indexes.map((index) => profile.terrain[index]!),
    sight: indexes.map((index) => profile.sight[index]!),
  }
}

export interface TraceSightLineRequest {
  from: LonLat
  to: LonLat
  fromEyeElevationMetres: number
  toEyeElevationMetres: number
  stepMetres: number
  sampler: ElevationSampler
  /** The longest the returned profile may be; the check itself uses every step. */
  maximumProfilePoints: number
}

export interface TraceSightLineResult {
  distanceMetres: number
  isClear: boolean
  /** Closest the line comes above the terrain, negative if the terrain is above it. */
  minimumClearanceMetres: number
  tightestAtMetres: number
  profile: TowerSightProfile
  /** True when a tile was missing somewhere between the two. */
  isIncomplete: boolean
}

/**
 * Whether two eyes could see each other: the straight line between them against
 * the terrain beneath, with the earth's bulge added to the terrain (it is
 * greatest mid-way, `d·(D−d)/2R`, which at a few kilometres is a fraction of a
 * metre — and the whole answer where the margin is that thin).
 */
export const traceSightLine = (request: TraceSightLineRequest): TraceSightLineResult => {
  const { from, to, fromEyeElevationMetres, toEyeElevationMetres, stepMetres, sampler } = request
  const distance = distanceMetresBetween(from, to)
  const stepCount = Math.max(2, Math.ceil(distance / stepMetres))

  const distances: number[] = []
  const terrain: number[] = []
  const sight: number[] = []
  let minimumClearance = Number.POSITIVE_INFINITY
  let tightestAt = 0
  let isIncomplete = false

  for (let step = 0; step <= stepCount; step++) {
    const fraction = step / stepCount
    const along = fraction * distance
    const lon = from.lon + (to.lon - from.lon) * fraction
    const lat = from.lat + (to.lat - from.lat) * fraction
    const elevation = sampler(lon, lat)

    if (elevation === null) {
      isIncomplete = true
      continue
    }

    const bulge =
      ((1 - REFRACTION_COEFFICIENT) * along * (distance - along)) / (2 * EARTH_RADIUS_METRES)
    const lineHeight =
      fromEyeElevationMetres + (toEyeElevationMetres - fromEyeElevationMetres) * fraction
    const effectiveTerrain = elevation + bulge
    distances.push(roundTo(along, 0))
    terrain.push(roundTo(effectiveTerrain, 1))
    sight.push(roundTo(lineHeight, 1))

    // The two ends stand on the ground they are measured from; only what lies
    // between can block.
    if (step > 0 && step < stepCount) {
      const clearance = lineHeight - effectiveTerrain
      if (clearance < minimumClearance) {
        minimumClearance = clearance
        tightestAt = along
      }
    }
  }

  const result: TowerSightProfile = decimateProfile({ distances, terrain, sight }, request)
  return {
    distanceMetres: distance,
    isClear: Number.isFinite(minimumClearance) && minimumClearance >= 0 && !isIncomplete,
    minimumClearanceMetres: Number.isFinite(minimumClearance) ? roundTo(minimumClearance, 1) : 0,
    tightestAtMetres: roundTo(tightestAt, 0),
    profile: result,
    isIncomplete,
  }
}
