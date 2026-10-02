import { scoreSiteCompleteness } from './completeness'

/**
 * What makes a site worth putting in front of someone who has not asked for it.
 *
 * "Featured" has no flag in this data: vici's import carries no editorial
 * marker, and inventing one by hand would not scale to 61,273 records. It is
 * therefore derived from what a visitor can see — a published photograph and a
 * description are the entry ticket (a card with neither has nothing to show),
 * and among those, richer records and ones other readers marked useful rank
 * higher. Distance is deliberately not part of the score: the query already
 * limits to the neighbourhood, and mixing the two would let a near but thin
 * record outrank a distinguished one a few kilometres further.
 *
 * Caps stop one very well-photographed site, or one endorsed by a crowd, from
 * outranking everything around it forever.
 */
const IMAGE_BONUS_CAP = 5
const IMAGE_BONUS = 0.1
const ENDORSEMENT_BONUS_CAP = 10
const ENDORSEMENT_BONUS = 0.05

export interface FeaturedCandidate {
  approvedImageCount: number
  endorsementCount: number
  hasDescription: boolean
  hasPeriod: boolean
  hasSummary: boolean
}

/** A record is only a candidate at all with a photograph and a description. */
export const isFeaturable = (candidate: FeaturedCandidate): boolean =>
  candidate.approvedImageCount > 0 && candidate.hasDescription

export const scoreFeaturedSite = (candidate: FeaturedCandidate): number => {
  const completeness = scoreSiteCompleteness({
    hasSummary: candidate.hasSummary,
    hasDescription: candidate.hasDescription,
    hasPeriod: candidate.hasPeriod,
    approvedImageCount: candidate.approvedImageCount,
  })
  const imageBonus = Math.min(candidate.approvedImageCount, IMAGE_BONUS_CAP) * IMAGE_BONUS
  const endorsementBonus =
    Math.min(candidate.endorsementCount, ENDORSEMENT_BONUS_CAP) * ENDORSEMENT_BONUS

  return completeness.score + imageBonus + endorsementBonus
}
