import { describe, expect, it } from 'vitest'
import { countsTowardsTrust, evaluateTrust, TRUST_THRESHOLD } from '../trust'

const contributor = (approvedContributions: number, trustRevoked = false) => ({
  approvedContributions,
  trustRevoked,
  role: 'contributor' as const,
})

describe('evaluateTrust', () => {
  it('queues contributions from a brand new account', () => {
    expect(evaluateTrust(contributor(0))).toEqual({
      level: 0,
      autoApprove: false,
      reason: 'probation',
    })
  })

  it('still queues the contribution that reaches one below the threshold', () => {
    const evaluation = evaluateTrust(contributor(TRUST_THRESHOLD - 1))
    expect(evaluation.autoApprove).toBe(false)
  })

  it('auto-approves once the threshold is reached', () => {
    const evaluation = evaluateTrust(contributor(TRUST_THRESHOLD))
    expect(evaluation).toEqual({ level: 1, autoApprove: true, reason: 'earned' })
  })

  it('lets a moderator revoke trust regardless of the contribution count', () => {
    const evaluation = evaluateTrust(contributor(50, true))
    expect(evaluation).toEqual({ level: 0, autoApprove: false, reason: 'revoked' })
  })

  it('never revokes a moderator through the contribution count', () => {
    const evaluation = evaluateTrust({
      approvedContributions: 0,
      trustRevoked: true,
      role: 'moderator',
    })
    expect(evaluation.autoApprove).toBe(true)
  })
})

describe('countsTowardsTrust', () => {
  it('counts sites and tracings but not images', () => {
    expect(countsTowardsTrust('site')).toBe(true)
    expect(countsTowardsTrust('tracing')).toBe(true)
    expect(countsTowardsTrust('image')).toBe(false)
  })
})
