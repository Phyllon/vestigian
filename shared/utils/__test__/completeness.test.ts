import { describe, expect, it } from 'vitest'
import {
  SITE_GAPS,
  mostValuableGap,
  scoreSiteCompleteness,
  type SiteCompletenessInput,
} from '../completeness'

/**
 * The ranking a contributor is shown. Asserted as a rule rather than left to
 * emerge from an ORDER BY, because "which of 61,273 sites should I walk to" is
 * a judgement, and a wrong one sends people to the wrong places.
 */

const input = (overrides: Partial<SiteCompletenessInput> = {}): SiteCompletenessInput => ({
  hasSummary: true,
  hasDescription: true,
  hasPeriod: true,
  approvedImageCount: 1,
  ...overrides,
})

describe('scoreSiteCompleteness', () => {
  it('scores a fully recorded site as complete, with nothing missing', () => {
    expect(scoreSiteCompleteness(input())).toEqual({ score: 1, missing: [] })
  })

  it('scores a site missing everything as zero', () => {
    const result = scoreSiteCompleteness(
      input({
        hasSummary: false,
        hasDescription: false,
        hasPeriod: false,
        approvedImageCount: 0,
      }),
    )

    expect(result.score).toBe(0)
    expect(result.missing).toEqual(['photograph', 'description', 'period', 'summary'])
  })

  /**
   * 82% of the atlas lacks a photograph, and it is the only gap that genuinely
   * requires standing at the site. It has to outrank everything else or the
   * queue sends people to do the work they could have done from a desk.
   */
  it('penalises a missing photograph more than any other single gap', () => {
    const noPhoto = scoreSiteCompleteness(input({ approvedImageCount: 0 })).score
    const noDescription = scoreSiteCompleteness(input({ hasDescription: false })).score
    const noPeriod = scoreSiteCompleteness(input({ hasPeriod: false })).score
    const noSummary = scoreSiteCompleteness(input({ hasSummary: false })).score

    expect(noPhoto).toBeLessThan(noDescription)
    expect(noDescription).toBeLessThan(noPeriod)
    expect(noPeriod).toBeLessThan(noSummary)
  })

  /** A pending upload has not filled the gap — only an approved photograph has. */
  it('counts only approved photographs', () => {
    expect(scoreSiteCompleteness(input({ approvedImageCount: 0 })).missing).toContain('photograph')
    expect(scoreSiteCompleteness(input({ approvedImageCount: 3 })).missing).not.toContain(
      'photograph',
    )
  })

  it('lists gaps most valuable first, so the top one is the best thing to do', () => {
    const result = scoreSiteCompleteness(
      input({ hasPeriod: false, approvedImageCount: 0, hasSummary: false }),
    )

    expect(result.missing).toEqual(['photograph', 'period', 'summary'])
  })

  /** Displayed as a percentage; 1 - (0.2 + 0.1) is otherwise 0.7000000000000001. */
  it('returns a score clean enough to render', () => {
    const result = scoreSiteCompleteness(input({ hasPeriod: false, hasSummary: false }))

    expect(result.score).toBeCloseTo(0.7, 10)
  })

  it('never returns a score outside 0…1, for any combination', () => {
    for (const photo of [0, 1]) {
      for (const summary of [true, false]) {
        for (const description of [true, false]) {
          for (const period of [true, false]) {
            const { score } = scoreSiteCompleteness({
              approvedImageCount: photo,
              hasSummary: summary,
              hasDescription: description,
              hasPeriod: period,
            })
            expect(score).toBeGreaterThanOrEqual(0)
            expect(score).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('only ever reports gaps from the known vocabulary', () => {
    const result = scoreSiteCompleteness(
      input({ hasSummary: false, hasDescription: false, hasPeriod: false, approvedImageCount: 0 }),
    )

    for (const gap of result.missing) expect(SITE_GAPS).toContain(gap)
  })
})

describe('mostValuableGap', () => {
  it('names the photograph when one is missing, whatever else is', () => {
    const completeness = scoreSiteCompleteness(
      input({ approvedImageCount: 0, hasDescription: false, hasPeriod: false }),
    )

    expect(mostValuableGap(completeness)).toBe('photograph')
  })

  it('falls through to the next gap when the photograph exists', () => {
    const completeness = scoreSiteCompleteness(input({ hasDescription: false, hasPeriod: false }))

    expect(mostValuableGap(completeness)).toBe('description')
  })

  it('is null for a record that wants nothing', () => {
    expect(mostValuableGap(scoreSiteCompleteness(input()))).toBeNull()
  })
})
