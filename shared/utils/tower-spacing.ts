import type {
  SightlineVariant,
  TowerSpacingBin,
  TowerSpacingPair,
  TowerSpacingSummary,
} from '../types'
import type { RayTrace } from './sightline'

/**
 * Were the towers of a sector set as far apart as the ground allowed? Pure
 * arithmetic over what `traceRay` already walks: for two neighbouring towers,
 * how much farther along the same line a tower of the same height would still
 * have been in sight — and so what share of that the builders used. See
 * `.claude/rules/sightlines.md`.
 *
 * A ratio near 1 means the towers stand about as far apart as they could and
 * still see each other. It is one reading of siting (signalling), and not the
 * only one: posts close together on ground that would have let them stand
 * apart are equally what mutual cover, a road crossing or a spring would give.
 */

/** The fewest read pairs on which a sector's spacing is described rather than withheld. */
export const TOWER_SPACING_MINIMUM_PAIRS = 5

/**
 * Two records nearer than this are one post — a tower and its reconstruction
 * stand 71 m apart on the Raetian Limes (Turm 14-48), a timber and a stone phase
 * a few metres. The twin fold (60 m) is the chain's rule; for a reading of
 * *spacing* a pair this close is not a spacing at all. A parameter, not a
 * finding.
 */
export const TOWER_SPACING_MINIMUM_SPAN_METRES = 100

/** How many pairs are named at each end of the distribution. */
export const TOWER_SPACING_OUTLIER_COUNT = 3

const BIN_COUNT = 10
const RATIO_CEILING = 10

export interface SpanReach {
  /** Metres from the first tower. */
  reachMetres: number
  /** True when the ground was open to the end of the calculation: the reach is "at least". */
  isCapped: boolean
  /** The far tower's platform is in sight from the near one. */
  isInSight: boolean
}

export interface SpanReachRequest {
  /** A ray from the near tower along the bearing to the far one, at the tower's own height both ends. */
  trace: RayTrace
  /** The distance between the two towers. */
  spanMetres: number
  stepMetres: number
}

/**
 * The farthest the far tower could have stood.
 *
 * In sight: the far tower is seen, and the reach is how far past it the ground
 * stays open — the first sample not seen at or beyond it. Not in sight: the
 * reach is the first sample not seen from the start, short of the span. Ground
 * that falls away between the two and comes back is not held against a pair
 * that can see each other (the far tower stands on the side where it returns).
 *
 * `null` when the terrain ran out before the answer was known: nothing is
 * claimed about ground that was not read.
 */
export const readSpanReach = (request: SpanReachRequest): SpanReach | null => {
  const { trace, spanMetres, stepMetres } = request
  const targetIndex = Math.max(1, Math.round(spanMetres / stepMetres)) - 1
  if (trace.isSeen.length <= targetIndex) return null

  const isInSight = trace.isSeen[targetIndex]!
  const searchFrom = isInSight ? targetIndex : 0
  let blockedAt = -1
  for (let index = searchFrom; index < trace.isSeen.length; index++) {
    if (!trace.isSeen[index]) {
      blockedAt = index
      break
    }
  }

  if (blockedAt < 0) {
    // Open to the last sample read. If the data ran out there, the reach is unknown.
    if (trace.isIncomplete) return null
    const last = trace.distances[trace.distances.length - 1] ?? 0
    return { reachMetres: Math.max(last, spanMetres), isCapped: true, isInSight }
  }

  const before = blockedAt === 0 ? 0 : trace.distances[blockedAt - 1]!
  // The far tower is not on the sampling grid; it is never "reached" by less than its own distance.
  const reachMetres = isInSight ? Math.max(before, spanMetres) : before
  return { reachMetres, isCapped: false, isInSight }
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Actual spacing ÷ reach, above 1 when the two could not see each other. */
export const spacingRatio = (pair: TowerSpacingPair, variant: SightlineVariant): number => {
  const reach = Math.max(pair.reachMetres[variant], 1)
  return Math.min(pair.lengthMetres / reach, RATIO_CEILING)
}

const emptyBins = (): TowerSpacingBin[] =>
  Array.from({ length: BIN_COUNT }, (_value, index) => ({
    fromRatio: roundTo(index / BIN_COUNT, 1),
    count: 0,
  }))

export interface SummariseSpacingRequest {
  pairs: readonly TowerSpacingPair[]
  droppedCount: number
}

export const summariseTowerSpacing = (request: SummariseSpacingRequest): TowerSpacingSummary => {
  const { pairs, droppedCount } = request
  const bins = emptyBins()

  const inSight = pairs.filter((pair) => pair.isInSight)
  for (const pair of inSight) {
    const ratio = spacingRatio(pair, 'central')
    const index = Math.min(BIN_COUNT - 1, Math.floor(ratio * BIN_COUNT))
    bins[index]!.count++
  }

  const ranked = inSight
    .map((pair) => ({ pair, ratio: spacingRatio(pair, 'central') }))
    .sort((first, second) => second.ratio - first.ratio)
  const nearest = ranked
    .filter((entry) => !entry.pair.isReachCapped.central)
    .slice(0, TOWER_SPACING_OUTLIER_COUNT)
  const farthest = ranked.slice(-TOWER_SPACING_OUTLIER_COUNT).reverse()

  const medianFor = (variant: SightlineVariant): number =>
    roundTo(median(pairs.map((pair) => spacingRatio(pair, variant))), 2)

  return {
    pairCount: pairs.length + droppedCount,
    readCount: pairs.length,
    droppedCount,
    isReadable: pairs.length >= TOWER_SPACING_MINIMUM_PAIRS,
    medianRatio: { low: medianFor('low'), central: medianFor('central'), high: medianFor('high') },
    outOfSightCount: pairs.length - inSight.length,
    cappedCount: pairs.filter((pair) => pair.isReachCapped.central).length,
    bins,
    nearestToLimit: nearest.map((entry) => entry.pair),
    farthestFromLimit: farthest.map((entry) => entry.pair),
    medianLengthMetres: Math.round(median(pairs.map((pair) => pair.lengthMetres))),
    medianReachMetres: Math.round(median(pairs.map((pair) => pair.reachMetres.central))),
  }
}
