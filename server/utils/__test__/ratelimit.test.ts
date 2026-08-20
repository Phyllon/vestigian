import { describe, expect, it } from 'vitest'
import { buildRateLimitKey, evaluateRateLimit, RATE_LIMITS } from '../ratelimit'

describe('buildRateLimitKey', () => {
  const base = { name: 'login' as const, identifier: '203.0.113.9', windowSeconds: 900 }

  it('keeps the same key inside one window', () => {
    const start = 1_700_000_000_000
    expect(buildRateLimitKey({ ...base, now: start })).toBe(
      buildRateLimitKey({ ...base, now: start + 60_000 }),
    )
  })

  it('rolls to a new key in the next window', () => {
    const start = 1_700_000_000_000
    expect(buildRateLimitKey({ ...base, now: start })).not.toBe(
      buildRateLimitKey({ ...base, now: start + 900_000 }),
    )
  })

  it('separates callers and policies', () => {
    const now = 1_700_000_000_000
    expect(buildRateLimitKey({ ...base, now })).not.toBe(
      buildRateLimitKey({ ...base, identifier: '198.51.100.4', now }),
    )
    expect(buildRateLimitKey({ ...base, now })).not.toBe(
      buildRateLimitKey({ ...base, name: 'register', now }),
    )
  })
})

describe('evaluateRateLimit', () => {
  const policy = RATE_LIMITS.login

  it('allows the request that lands exactly on the limit', () => {
    const decision = evaluateRateLimit({ count: policy.limit, policy, now: 0 })
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(0)
  })

  it('blocks the request after the limit', () => {
    expect(evaluateRateLimit({ count: policy.limit + 1, policy, now: 0 }).allowed).toBe(false)
  })

  it('reports a retry delay within the window length', () => {
    const decision = evaluateRateLimit({ count: 99, policy, now: 1_700_000_123_456 })
    expect(decision.retryAfterSeconds).toBeGreaterThan(0)
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(policy.windowSeconds)
  })
})
