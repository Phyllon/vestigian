import { describe, expect, it } from 'vitest'
import { planSample, sampleRateFor, type SampleDecisionInput } from '../sampling'
import { TRUST_THRESHOLD } from '#shared/utils/authorization'

/**
 * The spot-check on work that has already published.
 *
 * Asserted as a rule with the draw injected, never by sampling a probability —
 * a test that rolled real dice would be slow, flaky, and would be testing the
 * random number generator rather than this project's governance.
 */

const input = (overrides: Partial<SampleDecisionInput> = {}): SampleDecisionInput => ({
  approvedContributions: TRUST_THRESHOLD,
  autoApproved: true,
  authorRole: 'contributor',
  roll: 0,
  ...overrides,
})

describe('sampleRateFor', () => {
  it('is highest on the first contribution after trust is earned', () => {
    expect(sampleRateFor(TRUST_THRESHOLD)).toBe(0.5)
  })

  it('decays as the author accumulates accepted work', () => {
    const first = sampleRateFor(TRUST_THRESHOLD)
    const second = sampleRateFor(TRUST_THRESHOLD + 1)
    const tenth = sampleRateFor(TRUST_THRESHOLD + 9)

    expect(second).toBeLessThan(first)
    expect(tenth).toBeLessThan(second)
  })

  /**
   * The property that makes this worth having. A rate reaching zero would leave
   * long-standing accounts permanently unwatched — precisely the position a
   * patient bad actor would want to reach.
   */
  it('never decays to zero, however long the account has been trusted', () => {
    expect(sampleRateFor(10_000)).toBeGreaterThan(0)
    expect(sampleRateFor(10_000)).toBeCloseTo(0.05, 10)
  })

  it('never exceeds certainty, even below the threshold', () => {
    expect(sampleRateFor(0)).toBeLessThanOrEqual(1)
    expect(sampleRateFor(0)).toBe(0.5)
  })
})

describe('planSample', () => {
  it('draws a newly trusted contributor at the elevated rate', () => {
    const decision = planSample(input({ roll: 0.4 }))

    expect(decision).toMatchObject({ sample: true, reason: 'newly-trusted' })
  })

  it('leaves the same contribution alone when the draw misses', () => {
    expect(planSample(input({ roll: 0.9 }))).toMatchObject({ sample: false })
  })

  /**
   * Sampling is post-hoc review, not a gate. Work a moderator already approved
   * has had its second look — drawing it again would fill the queue with
   * decisions that were already made.
   */
  it('never samples work a moderator already approved', () => {
    expect(planSample(input({ autoApproved: false, roll: 0 }))).toMatchObject({ sample: false })
  })

  /**
   * Moderators and admins publish immediately because of their role, not an
   * earned count; they are already accountable through `admin_audit_log`, and
   * sampling them would crowd out the contributors this exists to watch.
   */
  it('never samples a moderator’s own contributions', () => {
    expect(planSample(input({ authorRole: 'moderator', roll: 0 }))).toMatchObject({ sample: false })
  })

  it('never samples an administrator’s own contributions', () => {
    expect(planSample(input({ authorRole: 'admin', roll: 0 }))).toMatchObject({ sample: false })
  })

  it('labels a draw at the permanent floor as a routine audit', () => {
    const decision = planSample(input({ approvedContributions: 500, roll: 0.01 }))

    expect(decision).toMatchObject({ sample: true, reason: 'routine-audit' })
  })

  /**
   * The boundary the reason label turns on: still inside the elevated window is
   * `newly-trusted`, at the floor it is the routine one-in-twenty. A moderator
   * triaging the queue reads that difference.
   */
  it('separates the elevated window from the routine floor', () => {
    const elevated = planSample(input({ approvedContributions: TRUST_THRESHOLD + 1, roll: 0 }))
    const routine = planSample(input({ approvedContributions: 1000, roll: 0 }))

    expect(elevated).toMatchObject({ reason: 'newly-trusted' })
    expect(routine).toMatchObject({ reason: 'routine-audit' })
  })

  it('reports the rate it used, so a decision can be explained after the fact', () => {
    const decision = planSample(input({ approvedContributions: TRUST_THRESHOLD, roll: 0.9 }))

    expect(decision.rate).toBe(0.5)
  })

  /** A draw exactly on the rate misses: the interval is [0, rate). */
  it('treats the rate as an exclusive bound', () => {
    expect(planSample(input({ roll: 0.5 }))).toMatchObject({ sample: false })
    expect(planSample(input({ roll: 0.499 }))).toMatchObject({ sample: true })
  })

  /**
   * Every trusted account stays occasionally visible. Asserted across the whole
   * decay curve rather than at one point, because a floor that only holds for
   * the first few contributions is not a floor.
   */
  it('keeps every account reachable at any length of service', () => {
    for (const count of [2, 3, 5, 20, 100, 5000]) {
      expect(planSample(input({ approvedContributions: count, roll: 0 }))).toMatchObject({
        sample: true,
      })
    }
  })
})
