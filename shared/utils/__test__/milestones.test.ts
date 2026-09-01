import { describe, expect, it } from 'vitest'
import { MILESTONE_ORDER, evaluateMilestones } from '../milestones'
import type { MilestoneInput, MilestoneMark } from '#shared/types'

const notebook = (overrides: Partial<MilestoneInput> = {}): MilestoneInput => ({
  role: 'contributor',
  trustRevoked: false,
  approvedContributions: 0,
  visitCount: 0,
  countriesVisited: 0,
  recordedAndVisitedCount: 0,
  ...overrides,
})

const marksOf = (input: MilestoneInput): MilestoneMark[] =>
  evaluateMilestones(input).map((milestone) => milestone.mark)

describe('evaluateMilestones', () => {
  it('gives a new account nothing', () => {
    expect(evaluateMilestones(notebook())).toEqual([])
  })

  it('marks the first accepted contribution, and only from one', () => {
    expect(marksOf(notebook({ approvedContributions: 0 }))).not.toContain('first-accepted')
    expect(marksOf(notebook({ approvedContributions: 1 }))).toContain('first-accepted')
  })

  it('marks trust at the same threshold the trust rule uses', () => {
    expect(marksOf(notebook({ approvedContributions: 1 }))).not.toContain('trusted')
    expect(marksOf(notebook({ approvedContributions: 2 }))).toContain('trusted')
  })

  it('withholds the trust mark when a moderator revoked it', () => {
    expect(marksOf(notebook({ approvedContributions: 9, trustRevoked: true }))).not.toContain(
      'trusted',
    )
  })

  /**
   * A moderator's edits bypass the queue by role, not by anything they earned.
   * Awarding them the mark would congratulate them for being appointed.
   */
  it('withholds the trust mark from moderators, who never earned it', () => {
    expect(marksOf(notebook({ role: 'moderator', approvedContributions: 0 }))).not.toContain(
      'trusted',
    )
    expect(marksOf(notebook({ role: 'admin', approvedContributions: 50 }))).not.toContain('trusted')
  })

  it('marks each visit threshold at its boundary and not before', () => {
    expect(marksOf(notebook({ visitCount: 0 }))).not.toContain('first-visit')
    expect(marksOf(notebook({ visitCount: 1 }))).toContain('first-visit')
    expect(marksOf(notebook({ visitCount: 9 }))).not.toContain('ten-visits')
    expect(marksOf(notebook({ visitCount: 10 }))).toContain('ten-visits')
    expect(marksOf(notebook({ visitCount: 99 }))).not.toContain('hundred-visits')
    expect(marksOf(notebook({ visitCount: 100 }))).toContain('hundred-visits')
  })

  it('marks a hundred accepted contributions at its boundary', () => {
    expect(marksOf(notebook({ approvedContributions: 99 }))).not.toContain('hundred-accepted')
    expect(marksOf(notebook({ approvedContributions: 100 }))).toContain('hundred-accepted')
  })

  it('marks five countries at its boundary', () => {
    expect(marksOf(notebook({ visitCount: 20, countriesVisited: 4 }))).not.toContain(
      'five-countries',
    )
    expect(marksOf(notebook({ visitCount: 20, countriesVisited: 5 }))).toContain('five-countries')
  })

  it('marks recording a place and then standing on it', () => {
    expect(marksOf(notebook({ recordedAndVisitedCount: 0 }))).not.toContain('recorded-and-stood')
    expect(marksOf(notebook({ recordedAndVisitedCount: 1 }))).toContain('recorded-and-stood')
  })

  it('keeps the dates it is given and invents none for the thresholds', () => {
    const earned = evaluateMilestones(
      notebook({ visitCount: 12, firstVisitAt: '2026-04-02T00:00:00.000Z' }),
    )
    expect(earned.find((milestone) => milestone.mark === 'first-visit')?.at).toBe(
      '2026-04-02T00:00:00.000Z',
    )
    expect(earned.find((milestone) => milestone.mark === 'ten-visits')?.at).toBeNull()
  })

  it('returns rarest first', () => {
    const marks = marksOf(
      notebook({
        approvedContributions: 100,
        visitCount: 100,
        countriesVisited: 5,
        recordedAndVisitedCount: 1,
      }),
    )
    expect(marks).toEqual(MILESTONE_ORDER)
  })
})

/**
 * The marks double as i18n keys (`milestones.<mark>.*`). A rename that misses a
 * locale file shows an empty label rather than failing, so the set is pinned.
 */
describe('MILESTONE_ORDER', () => {
  it('covers every mark exactly once', () => {
    expect(new Set(MILESTONE_ORDER).size).toBe(MILESTONE_ORDER.length)
    expect([...MILESTONE_ORDER].sort()).toEqual([
      'first-accepted',
      'first-visit',
      'five-countries',
      'hundred-accepted',
      'hundred-visits',
      'recorded-and-stood',
      'ten-visits',
      'trusted',
    ])
  })
})
