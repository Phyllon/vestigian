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

const ELLIPSIS = '…'
const TRAILING_PUNCTUATION = new Set([' ', ',', ';', ':', '.', '-', '–', '—'])

/** A loop rather than a pattern: `[…]+$` backtracks quadratically on a long run of spaces. */
const trimTrailingPunctuation = (text: string): string => {
  let end = text.length
  while (end > 0 && TRAILING_PUNCTUATION.has(text.charAt(end - 1))) end -= 1
  return text.slice(0, end)
}

/**
 * A summary cut to at most `maximumLength` characters (the ellipsis included),
 * at the last word that fits. Collapses runs of whitespace first so a line
 * break inside a summary cannot eat the budget. Returns `null` for nothing to
 * show, so the caller needs no empty-string check of its own.
 */
export const excerptSummary = (
  summary: string | null | undefined,
  maximumLength: number,
): string | null => {
  const text = summary?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= maximumLength) return text

  const room = text.slice(0, Math.max(maximumLength - ELLIPSIS.length, 0))
  const lastSpace = room.lastIndexOf(' ')
  // A single very long word has no boundary to cut at; cut inside it.
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room
  return `${trimTrailingPunctuation(cut)}${ELLIPSIS}`
}
