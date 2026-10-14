import { describe, expect, it } from 'vitest'
import type { SightlineVariant, TowerSpacingPair } from '../../types'
import { distanceMetresBetween, towerEyeHeights, traceRay } from '../sightline'
import type { ElevationSampler } from '../sightline'
import {
  TOWER_SPACING_MINIMUM_PAIRS,
  readSpanReach,
  spacingRatio,
  summariseTowerSpacing,
} from '../tower-spacing'

const ORIGIN = { lon: 8.5, lat: 50.2 }
const STEP = 15
const RADIUS = 10_000
const eye = towerEyeHeights().central

/** A ray due east from the origin, at the middle height at both ends. */
const traceEast = (sampler: ElevationSampler) =>
  traceRay({
    origin: ORIGIN,
    originElevationMetres: 0,
    bearingDegrees: 90,
    eyeHeightMetres: eye,
    targetHeightMetres: eye,
    radiusMetres: RADIUS,
    stepMetres: STEP,
    sampler,
  })

const alongOf = (lon: number): number => distanceMetresBetween(ORIGIN, { lon, lat: ORIGIN.lat })

/** Ground at `height` between two distances east of the origin, level elsewhere. */
const wall =
  (from: number, to: number, height: number): ElevationSampler =>
  (lon) => {
    const along = alongOf(lon)
    return along >= from && along <= to ? height : 0
  }

describe('how far a neighbouring tower could have stood', () => {
  it('runs to the end of the calculation over level ground, and says it is only "at least"', () => {
    const result = readSpanReach({ trace: traceEast(() => 0), spanMetres: 2_000, stepMetres: STEP })
    expect(result).not.toBeNull()
    expect(result!.isInSight).toBe(true)
    expect(result!.isCapped).toBe(true)
    expect(result!.reachMetres).toBeGreaterThan(9_900)
  })

  it('ends at the far side of the ridge, where a tower set behind it would be hidden', () => {
    // A 60 m ridge 3 km out, 300 m across: a tower on its crest would be seen, one behind it not.
    const result = readSpanReach({
      trace: traceEast(wall(3_000, 3_300, 60)),
      spanMetres: 2_000,
      stepMetres: STEP,
    })
    expect(result!.isInSight).toBe(true)
    expect(result!.isCapped).toBe(false)
    expect(result!.reachMetres).toBeGreaterThan(3_200)
    expect(result!.reachMetres).toBeLessThan(3_400)
  })

  it('gives the distance to the obstruction when the two cannot see each other', () => {
    const result = readSpanReach({
      trace: traceEast(wall(1_000, 1_200, 50)),
      spanMetres: 2_000,
      stepMetres: STEP,
    })
    expect(result!.isInSight).toBe(false)
    // Ground is open to the far edge of the ridge (1,200 m); the tower at 2 km is in its shadow.
    expect(result!.reachMetres).toBeGreaterThan(1_100)
    expect(result!.reachMetres).toBeLessThan(1_300)
  })

  it('does not hold a hollow against two towers that can see each other across it', () => {
    // A 15 m rise at 500 m hides ground behind it, but the far tower at 2 km is high enough to be seen over it.
    const result = readSpanReach({
      trace: traceEast((lon) => {
        const along = alongOf(lon)
        if (along >= 1_700) return 40
        return along >= 480 && along <= 520 ? 6 : 0
      }),
      spanMetres: 2_000,
      stepMetres: STEP,
    })
    expect(result!.isInSight).toBe(true)
    expect(result!.reachMetres).toBeGreaterThanOrEqual(2_000)
  })

  it('is never shorter than the span it was measured for when the two are in sight', () => {
    const result = readSpanReach({
      trace: traceEast(wall(2_005, 2_100, 80)),
      spanMetres: 2_000,
      stepMetres: STEP,
    })
    expect(result!.isInSight).toBe(true)
    expect(result!.reachMetres).toBeGreaterThanOrEqual(2_000)
  })

  it('claims nothing when the terrain ran out before the far tower', () => {
    const short: ElevationSampler = (lon) => (alongOf(lon) > 1_500 ? null : 0)
    expect(
      readSpanReach({ trace: traceEast(short), spanMetres: 2_000, stepMetres: STEP }),
    ).toBeNull()
  })

  it('claims nothing when the ground is open but the data ran out beyond the far tower', () => {
    const edge: ElevationSampler = (lon) => (alongOf(lon) > 2_500 ? null : 0)
    expect(
      readSpanReach({ trace: traceEast(edge), spanMetres: 2_000, stepMetres: STEP }),
    ).toBeNull()
  })
})

const pair = (
  lengthMetres: number,
  reach: number,
  overrides: Partial<TowerSpacingPair> = {},
): TowerSpacingPair => {
  const reaches = Object.fromEntries(
    (['low', 'central', 'high'] as const).map((variant) => [variant, reach]),
  ) as Record<SightlineVariant, number>
  const capped = Object.fromEntries(
    (['low', 'central', 'high'] as const).map((variant) => [variant, false]),
  ) as Record<SightlineVariant, boolean>
  return {
    fromSiteId: 1,
    fromTitle: 'A',
    toSiteId: 2,
    toTitle: 'B',
    position: { lon: 8, lat: 49 },
    lengthMetres,
    reachMetres: reaches,
    isReachCapped: capped,
    isInSight: reach >= lengthMetres,
    ...overrides,
  }
}

describe('the spacing ratio', () => {
  it('is spacing over reach, and above one when the pair could not see each other', () => {
    expect(spacingRatio(pair(500, 1_000), 'central')).toBe(0.5)
    expect(spacingRatio(pair(1_000, 500), 'central')).toBe(2)
  })

  it('does not divide by nothing', () => {
    expect(spacingRatio(pair(500, 0), 'central')).toBeLessThanOrEqual(10)
  })
})

describe('a sector’s spacing summary', () => {
  const six = [
    pair(500, 1_000),
    pair(600, 1_000),
    pair(900, 1_000),
    pair(950, 1_000),
    pair(200, 4_000, { isReachCapped: { low: true, central: true, high: true } }),
    pair(1_500, 700),
  ]

  it('bins the pairs in sight by tenths and counts the ones out of sight apart', () => {
    const summary = summariseTowerSpacing({ pairs: six, droppedCount: 2 })
    expect(summary.pairCount).toBe(8)
    expect(summary.readCount).toBe(6)
    expect(summary.droppedCount).toBe(2)
    expect(summary.outOfSightCount).toBe(1)
    expect(summary.bins).toHaveLength(10)
    expect(summary.bins.reduce((total, bin) => total + bin.count, 0)).toBe(5)
    expect(summary.bins[0]).toEqual({ fromRatio: 0, count: 1 }) // 0.05
    expect(summary.bins[5]!.count).toBe(1) // 0.5
    expect(summary.bins[9]!.count).toBe(2) // 0.9 and 0.95
  })

  it('files a pair standing exactly at its reach in the last bin', () => {
    const summary = summariseTowerSpacing({ pairs: [pair(1_000, 1_000)], droppedCount: 0 })
    expect(summary.bins[9]!.count).toBe(1)
  })

  it('takes the median over every pair read, out of sight included', () => {
    const summary = summariseTowerSpacing({ pairs: six, droppedCount: 0 })
    // ratios: 0.5, 0.6, 0.9, 0.95, 0.05, 2.14 → sorted 0.05 0.5 0.6 0.9 0.95 2.14 → (0.6+0.9)/2
    expect(summary.medianRatio.central).toBe(0.75)
    expect(summary.medianLengthMetres).toBe(750)
  })

  it('names the pairs nearest the limit without trusting a reach that was only a lower bound', () => {
    const summary = summariseTowerSpacing({ pairs: six, droppedCount: 0 })
    expect(summary.nearestToLimit.map((item) => item.lengthMetres)).toEqual([950, 900, 600])
    expect(summary.farthestFromLimit[0]!.lengthMetres).toBe(200)
  })

  it('is withheld below the minimum number of pairs', () => {
    const few = six.slice(0, TOWER_SPACING_MINIMUM_PAIRS - 1)
    expect(summariseTowerSpacing({ pairs: few, droppedCount: 0 }).isReadable).toBe(false)
    expect(summariseTowerSpacing({ pairs: six, droppedCount: 0 }).isReadable).toBe(true)
  })

  it('reads an empty sector without dividing by anything', () => {
    const summary = summariseTowerSpacing({ pairs: [], droppedCount: 3 })
    expect(summary.readCount).toBe(0)
    expect(summary.medianRatio.central).toBe(0)
    expect(summary.isReadable).toBe(false)
  })
})
