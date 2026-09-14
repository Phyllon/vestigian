/**
 * What a site record is still missing, and how much that matters.
 *
 * This atlas imported 61,273 sites and has no way to tell anyone which of them
 * need work. That is the cold-start problem stated precisely: a project whose
 * premise is "recorded by the people who visit them" gave visitors a map to
 * browse and no queue to work from. Measured against the real catalogue:
 *
 * | Gap            | Sites lacking it | Share |
 * | -------------- | ---------------- | ----- |
 * | a photograph   | 49,964           | 82%   |
 * | a period       | 29,905           | 49%   |
 * | a description  | 29,417           | 48%   |
 * | a summary      | 5                | ~0%   |
 *
 * Only gaps a visitor can actually close are counted. Concordances are
 * deliberately absent: there is no field for them in `SiteEditorForm` and
 * `SitePayload` carries none, so listing a site as incomplete for lacking one
 * would be asking for something the application cannot accept.
 *
 * Pure, and tested, so the ranking a contributor is shown is a rule rather than
 * an accident of SQL.
 */

export type SiteGap = 'photograph' | 'description' | 'period' | 'summary'

/**
 * Weights, summing to 1, set by how much closing the gap adds *and* by who can
 * close it.
 *
 * A photograph is weighted highest for both reasons at once: it is the scarcest
 * thing in the atlas by a wide margin, and it is the only one of the four that
 * genuinely requires someone to stand at the site. A summary is worth least
 * because it is effectively already universal — five records lack one — so
 * weighting it heavily would rank on a distinction that barely exists.
 */
const GAP_WEIGHTS: Record<SiteGap, number> = {
  photograph: 0.4,
  description: 0.3,
  period: 0.2,
  summary: 0.1,
}

/** Ranked as a contributor would work through them, most valuable first. */
export const SITE_GAPS: SiteGap[] = ['photograph', 'description', 'period', 'summary']

export interface SiteCompletenessInput {
  hasSummary: boolean
  hasDescription: boolean
  hasPeriod: boolean
  /** Approved photographs only — a pending upload has not filled the gap yet. */
  approvedImageCount: number
}

export interface SiteCompleteness {
  /** 1 when nothing actionable is missing, 0 when everything is. */
  score: number
  /** Most valuable gap first, so a caller can show the best thing to do next. */
  missing: SiteGap[]
}

export const scoreSiteCompleteness = (input: SiteCompletenessInput): SiteCompleteness => {
  const missing: SiteGap[] = []

  if (input.approvedImageCount <= 0) missing.push('photograph')
  if (!input.hasDescription) missing.push('description')
  if (!input.hasPeriod) missing.push('period')
  if (!input.hasSummary) missing.push('summary')

  const lost = missing.reduce((total, gap) => total + GAP_WEIGHTS[gap], 0)

  // Rounded because the value is displayed as a percentage and floating-point
  // addition of the weights above otherwise yields 0.7000000000000001.
  return { score: Math.round((1 - lost) * 100) / 100, missing }
}

/**
 * The single most useful thing a visitor could add, or null when the record
 * wants nothing. Not simply `missing[0]` by accident — `SITE_GAPS` order is the
 * priority, and `missing` is built in that order deliberately.
 */
export const mostValuableGap = (completeness: SiteCompleteness): SiteGap | null =>
  completeness.missing[0] ?? null
