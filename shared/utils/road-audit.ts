/**
 * What the atlas's other records say about a conjectured Itiner-e road — the
 * evidence a segment can be read against, never a verdict on it. Pure: counts
 * come in as plain numbers, so a test needs no database and the build script
 * and the interface cannot disagree about what a number means.
 *
 * Every figure here is a parameter of the reading, not a finding about the
 * Roman world. See `.claude/rules/road-audit.md` for what was measured to set
 * them and what the evidence cannot say.
 */

/** Part of every row the build writes: change what is counted or how, and bump this. */
export const ROAD_AUDIT_MODEL_VERSION = 1

/**
 * How near a find must be to count for a segment. Set from the data: the median
 * distance from a located milestone to the nearest Itiner-e road is 261 m (vici,
 * 1,003) and 307 m (EDH, 160), so a 200 m buffer would miss more than half of the
 * stones that do belong to a road. A road's own digitised line is not better than
 * that, and a findspot is a village, not the spot.
 */
export const ROAD_AUDIT_BUFFER_METRES = 300

/**
 * Past this a milestone is called far from every known road. Three times the
 * buffer; 73% of located milestones lie within it, so what remains is a short
 * list, not a fringe.
 */
export const ROAD_GAP_DISTANCE_METRES = 1000

/** A stretch must be at least this long to be given a gradient (a pixel pair can read 40%). */
export const ROAD_AUDIT_GRADIENT_WINDOW_METRES = 250

/**
 * The gradient at which a stretch is named steep. Calibrated, not cited: the 99th
 * percentile of the steepest 250 m stretch over the 967 surveyed (`certain`)
 * segments, 35.9% on Mapterhorn's terrain at zoom 10 (14 Oct 2026; the 95th is
 * 23.7%). So it says "steeper than 99 in 100 surveyed segments read on the same
 * terrain" and nothing about what a Roman engineer would have tolerated.
 *
 * Tied to the terrain it was measured on: a coarser model flattens the ground
 * and a finer one steepens it, so `pnpm roads:audit` prints the new percentile
 * and this constant moves with `--zoom`. Even surveyed roads read 22% at the
 * 95th: a digitised line that crosses a valley picks up its walls. That is why
 * the threshold comes from the surveyed distribution rather than from a number.
 */
export const ROAD_AUDIT_STEEP_GRADIENT_PERCENT = 36

export interface RoadAuditEvidence {
  edhMilestones: number
  viciMilestones: number
  viciRoadSites: number
  /** How many of the segment's two ends meet a surveyed segment, 0–2. */
  certainEnds: number
  /** Absolute percentage, or null where no gradient could be read. */
  steepestGradientPercent: number | null
}

/** Records that stand at or near the road, whichever database holds them. */
export const countFindsNearRoad = (evidence: RoadAuditEvidence): number =>
  evidence.edhMilestones + evidence.viciMilestones + evidence.viciRoadSites

export const isSupportedByFinds = (evidence: RoadAuditEvidence): boolean =>
  countFindsNearRoad(evidence) > 0

export const isSteepStretch = (gradientPercent: number | null): boolean =>
  gradientPercent !== null && gradientPercent >= ROAD_AUDIT_STEEP_GRADIENT_PERCENT

export type RoadCertainty = 'certain' | 'conjectured' | 'hypothetical'

export interface RankableRoadSegment {
  certainty: RoadCertainty
  lengthMetres: number
  evidence: RoadAuditEvidence
}

/**
 * Lower sorts first. The list worth reading is a *conjectured* road nothing
 * stands near; a hypothetical one is the source's own weakest claim, so finding
 * nothing beside it tells less. Within a tier a steep stretch comes first, the
 * steeper the sooner, then the longer segment (more of the model rests on it).
 *
 * Steepest-stretch is an extreme value: the longer a segment, the more windows
 * it has to be steep in (1% of segments of 1–5 km read steep, 15% of those over
 * 50 km). Ordering the steep ones by gradient and not by length keeps that from
 * putting the longest first for no better reason than that they are long.
 */
const rankOf = (segment: RankableRoadSegment): number => {
  const unsupported = isSupportedByFinds(segment.evidence) ? 2 : 0
  const hypothetical = segment.certainty === 'hypothetical' ? 1 : 0
  return unsupported + hypothetical
}

export const compareForAuditList = (a: RankableRoadSegment, b: RankableRoadSegment): number => {
  const byTier = rankOf(a) - rankOf(b)
  if (byTier !== 0) return byTier

  const steepA = isSteepStretch(a.evidence.steepestGradientPercent)
  const steepB = isSteepStretch(b.evidence.steepestGradientPercent)
  if (steepA !== steepB) return steepA ? -1 : 1
  if (steepA && steepB) {
    const byGradient =
      (b.evidence.steepestGradientPercent ?? 0) - (a.evidence.steepestGradientPercent ?? 0)
    if (byGradient !== 0) return byGradient
  }
  return b.lengthMetres - a.lengthMetres
}

export interface RoadAuditTotals {
  segments: number
  supported: number
  unsupported: number
  steep: number
  /** Steep and with nothing standing near it. */
  steepAndUnsupported: number
  withoutGradient: number
}

export const summariseRoadAudit = (
  segments: readonly Pick<RankableRoadSegment, 'evidence'>[],
): RoadAuditTotals => {
  const totals: RoadAuditTotals = {
    segments: segments.length,
    supported: 0,
    unsupported: 0,
    steep: 0,
    steepAndUnsupported: 0,
    withoutGradient: 0,
  }
  for (const { evidence } of segments) {
    const supported = isSupportedByFinds(evidence)
    const steep = isSteepStretch(evidence.steepestGradientPercent)
    if (supported) totals.supported++
    else totals.unsupported++
    if (steep) totals.steep++
    if (steep && !supported) totals.steepAndUnsupported++
    if (evidence.steepestGradientPercent === null) totals.withoutGradient++
  }
  return totals
}

/** Percentile (0–1) of a list by nearest rank; null for an empty one. */
export const percentileOf = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? null
}
