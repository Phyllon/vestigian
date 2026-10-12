import type { ElevationProfileStats, LonLat } from '../types'
import { distanceMetresBetween } from './sightline'

/**
 * Walking a drawn line and reading its relief. Pure: the terrain comes in as a
 * sampler, so a test can use a staircase and the server a tile mosaic.
 */

export interface PolylineSample {
  position: LonLat
  /** Metres along the whole line, parts joined end to end. */
  distanceMetres: number
}

export interface SamplePolylineRequest {
  /** One entry per part of the line; a plain LineString is a single part. */
  parts: readonly (readonly [number, number][])[]
  /** The finest spacing wanted. */
  minimumStepMetres: number
  /** The most samples to return in all; a long line is sampled more coarsely. */
  maximumSamples: number
}

export interface SamplePolylineResult {
  samples: PolylineSample[]
  /** Sample indexes at which a further part begins. */
  breaks: number[]
  lengthMetres: number
}

const lengthOf = (part: readonly [number, number][]): number => {
  let total = 0
  for (let index = 1; index < part.length; index++) {
    total += distanceMetresBetween(
      { lon: part[index - 1]![0], lat: part[index - 1]![1] },
      { lon: part[index]![0], lat: part[index]![1] },
    )
  }
  return total
}

/**
 * Evenly spaced samples along a line, always including both ends of every part.
 *
 * Parts are walked in the order given and joined without a gap in distance: the
 * profile is of the line as drawn, and a hole between two traces would be
 * measured as ground neither of them covers. Where it matters the breaks say so.
 */
export const samplePolyline = (request: SamplePolylineRequest): SamplePolylineResult => {
  const { parts, minimumStepMetres, maximumSamples } = request
  const lengths = parts.map(lengthOf)
  const lengthMetres = lengths.reduce((sum, length) => sum + length, 0)
  const step = Math.max(
    minimumStepMetres,
    lengthMetres / Math.max(maximumSamples - parts.length, 1),
  )

  const samples: PolylineSample[] = []
  const breaks: number[] = []
  let offset = 0

  parts.forEach((part, partIndex) => {
    if (part.length === 0) return
    if (partIndex > 0 && samples.length > 0) breaks.push(samples.length)

    const first = part[0]!
    samples.push({ position: { lon: first[0], lat: first[1] }, distanceMetres: offset })

    let walked = 0
    let nextAt = step
    for (let index = 1; index < part.length; index++) {
      const from = { lon: part[index - 1]![0], lat: part[index - 1]![1] }
      const to = { lon: part[index]![0], lat: part[index]![1] }
      const segment = distanceMetresBetween(from, to)
      if (segment === 0) continue

      while (nextAt <= walked + segment) {
        const fraction = (nextAt - walked) / segment
        samples.push({
          position: {
            lon: from.lon + (to.lon - from.lon) * fraction,
            lat: from.lat + (to.lat - from.lat) * fraction,
          },
          distanceMetres: offset + nextAt,
        })
        nextAt += step
      }
      walked += segment
    }

    const last = part[part.length - 1]!
    const lastDistance = offset + lengths[partIndex]!
    const previous = samples[samples.length - 1]!
    if (lastDistance - previous.distanceMetres > 0.5) {
      samples.push({ position: { lon: last[0], lat: last[1] }, distanceMetres: lastDistance })
    }
    offset = lastDistance
  })

  return { samples, breaks, lengthMetres }
}

/**
 * Replaces missing readings (null) by interpolating between the nearest present
 * ones, and says how many were there. A run missing from the very start or end
 * takes the nearest value rather than inventing a slope.
 */
export const fillElevationGaps = (
  readings: readonly (number | null)[],
): { elevations: number[]; coverage: number } => {
  const presentIndexes: number[] = []
  readings.forEach((value, index) => {
    if (value !== null) presentIndexes.push(index)
  })
  if (presentIndexes.length === 0) return { elevations: readings.map(() => 0), coverage: 0 }

  // For each position, the nearest present reading on either side (or itself).
  const elevations = readings.map((_value, index) => {
    const after = presentIndexes.find((present) => present >= index)
    const before = [...presentIndexes].reverse().find((present) => present <= index)
    if (before === undefined) return readings[after!]!
    if (after === undefined || before === after) return readings[before]!
    const start = readings[before]!
    const end = readings[after]!
    return start + ((end - start) * (index - before)) / (after - before)
  })

  return { elevations, coverage: presentIndexes.length / readings.length }
}

/**
 * Wobbles under this are noise in a terrain model, not climbing: a model sampled
 * every few tens of metres reads a metre up and a metre down across a field, and
 * adding all of it makes a flat road a hill.
 */
export const ASCENT_NOISE_FLOOR_METRES = 3

/** A stretch must be at least this long to name a gradient: a pixel pair can read 40%. */
export const GRADIENT_WINDOW_METRES = 150

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export interface SummariseElevationProfileRequest {
  distances: readonly number[]
  elevations: readonly number[]
  gradientWindowMetres?: number
}

/**
 * The extremes of the line that are believed: a turn counts only once the line
 * has come back by more than the noise floor from its last extreme.
 */
const turningPoints = (elevations: readonly number[]): number[] => {
  const first = elevations[0] ?? 0
  const points = [first]
  let candidate = first
  // 1 while rising, -1 while falling, 0 until the line has moved by more than noise.
  let direction = 0

  for (let index = 1; index < elevations.length; index++) {
    const value = elevations[index]!
    const progress = (value - candidate) * (direction === 0 ? 1 : direction)

    if (direction === 0) {
      if (Math.abs(value - candidate) >= ASCENT_NOISE_FLOOR_METRES) {
        direction = value > candidate ? 1 : -1
        candidate = value
      }
    } else if (progress > 0) {
      candidate = value
    } else if (-progress >= ASCENT_NOISE_FLOOR_METRES) {
      points.push(candidate)
      direction = -direction
      candidate = value
    }
  }

  points.push(candidate)
  return points
}

const climbAndFall = (elevations: readonly number[]): { ascent: number; descent: number } => {
  const points = turningPoints(elevations)
  let ascent = 0
  let descent = 0
  for (let index = 1; index < points.length; index++) {
    const change = points[index]! - points[index - 1]!
    if (change > 0) ascent += change
    else descent -= change
  }
  return { ascent, descent }
}

/** The steepest slope over a span of at least `windowMetres`, signed, and where its middle lies. */
const steepestStretch = (
  distances: readonly number[],
  elevations: readonly number[],
  windowMetres: number,
): { gradient: number; atMetres: number } => {
  let best = { gradient: 0, atMetres: 0 }
  let tail = 0

  for (let head = 0; head < distances.length; head++) {
    while (tail < head && distances[head]! - distances[tail + 1]! >= windowMetres) tail++
    const span = distances[head]! - distances[tail]!
    if (span < windowMetres) continue

    const gradient = ((elevations[head]! - elevations[tail]!) / span) * 100
    if (Math.abs(gradient) > Math.abs(best.gradient)) {
      best = { gradient, atMetres: (distances[head]! + distances[tail]!) / 2 }
    }
  }
  return best
}

const extremes = (
  distances: readonly number[],
  elevations: readonly number[],
): ElevationProfileStats['lowest'][] => {
  let lowest = { metres: Number.POSITIVE_INFINITY, atMetres: 0 }
  let highest = { metres: Number.NEGATIVE_INFINITY, atMetres: 0 }
  elevations.forEach((metres, index) => {
    if (metres < lowest.metres) lowest = { metres, atMetres: distances[index]! }
    if (metres > highest.metres) highest = { metres, atMetres: distances[index]! }
  })
  return [lowest, highest]
}

export const summariseElevationProfile = (
  request: SummariseElevationProfileRequest,
): ElevationProfileStats => {
  const { distances, elevations } = request
  const lengthMetres = distances[distances.length - 1] ?? 0
  // A long line is sampled coarsely, so a window shorter than the spacing would
  // quietly be the spacing anyway; say what was actually measured.
  const meanSpacing = distances.length > 1 ? lengthMetres / (distances.length - 1) : 0
  const gradientWindowMetres = Math.max(
    request.gradientWindowMetres ?? GRADIENT_WINDOW_METRES,
    Math.round(meanSpacing),
  )

  const [lowest, highest] = extremes(distances, elevations) as [
    ElevationProfileStats['lowest'],
    ElevationProfileStats['highest'],
  ]
  const { ascent, descent } = climbAndFall(elevations)
  const steepest = steepestStretch(distances, elevations, gradientWindowMetres)
  const start = elevations[0] ?? 0
  const end = elevations[elevations.length - 1] ?? 0

  return {
    lengthMetres: roundTo(lengthMetres, 0),
    startMetres: roundTo(start, 0),
    endMetres: roundTo(end, 0),
    lowest: { metres: roundTo(lowest.metres, 0), atMetres: roundTo(lowest.atMetres, 0) },
    highest: { metres: roundTo(highest.metres, 0), atMetres: roundTo(highest.atMetres, 0) },
    ascentMetres: roundTo(ascent, 0),
    descentMetres: roundTo(descent, 0),
    averageGradientPercent: lengthMetres > 0 ? roundTo(((end - start) / lengthMetres) * 100, 2) : 0,
    steepestGradientPercent: roundTo(steepest.gradient, 1),
    steepestAtMetres: roundTo(steepest.atMetres, 0),
    gradientWindowMetres,
  }
}
