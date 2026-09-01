import { evaluateTrust } from './authorization'
import type { Milestone, MilestoneInput, MilestoneMark } from '#shared/types'

/**
 * Quiet marks in the margin of the notebook — what someone has done here,
 * stated once and without ceremony.
 *
 * **Derived on read, never stored.** This is the same decision that deleted
 * `users.trust_level` in migration 0002: a denormalised column recording a
 * threshold rule is written by hand-transcribed copies of that rule, in places
 * no test reaches, and goes stale the day the threshold moves. Every mark below
 * is a pure function of counts the database already keeps, so there is nothing
 * to backfill and nothing to invalidate.
 *
 * The deliberate omissions matter as much as the marks. There are no points, no
 * streaks, no levels and no leaderboard. A streak rewards frequency, which for
 * an atlas of physical places means rewarding whoever lives nearest to a
 * frontier; a leaderboard turns a shared record into a contest and gives
 * everyone a reason to submit thin records quickly. The marks here are all
 * either *the first time* something happened or *a round number of* something,
 * both of which a person can read once and never think about again.
 *
 * Ordered from rarest to most common in `MILESTONE_ORDER`, so a page rendering
 * them can show the most telling one first without restating that judgement.
 */

/** More than two inputs, so: a named interface, per the project conventions. */
export const evaluateMilestones = (input: MilestoneInput): Milestone[] => {
  const marks: Milestone[] = []

  if (input.approvedContributions >= 1) {
    marks.push({ mark: 'first-accepted', at: input.firstAcceptedAt ?? null })
  }

  if (evaluateTrust(input).autoApprove && input.role === 'contributor') {
    marks.push({ mark: 'trusted', at: null })
  }

  if (input.approvedContributions >= 100) {
    marks.push({ mark: 'hundred-accepted', at: null })
  }

  if (input.visitCount >= 1) {
    marks.push({ mark: 'first-visit', at: input.firstVisitAt ?? null })
  }

  if (input.visitCount >= 10) {
    marks.push({ mark: 'ten-visits', at: null })
  }

  if (input.visitCount >= 100) {
    marks.push({ mark: 'hundred-visits', at: null })
  }

  if (input.countriesVisited >= 5) {
    marks.push({ mark: 'five-countries', at: null })
  }

  /**
   * The one mark worth having. Recording a place and then standing on it is the
   * entire thesis of this project in a single fact, and it is the only mark
   * here that cannot be earned from a desk.
   */
  if (input.recordedAndVisitedCount >= 1) {
    marks.push({ mark: 'recorded-and-stood', at: null })
  }

  return marks.sort((a, b) => MILESTONE_ORDER.indexOf(a.mark) - MILESTONE_ORDER.indexOf(b.mark))
}

/** Rarest first. A page showing one mark should show the most telling one. */
export const MILESTONE_ORDER: MilestoneMark[] = [
  'recorded-and-stood',
  'hundred-accepted',
  'hundred-visits',
  'five-countries',
  'ten-visits',
  'trusted',
  'first-accepted',
  'first-visit',
]
