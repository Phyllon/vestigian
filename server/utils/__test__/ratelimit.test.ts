import { describe, expect, it } from 'vitest'
import {
  buildRateLimitKey,
  evaluateRateLimit,
  RATE_LIMITS,
  resolveForwardedIdentifier,
} from '../ratelimit'

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

describe('resolveForwardedIdentifier', () => {
  const spoofed = {
    socketAddress: '198.51.100.7',
    realIp: '203.0.113.99',
  }

  /**
   * The bug this function exists to close. `cf-connecting-ip` used to be taken
   * whenever present, so anything able to reach the origin could send a fresh
   * value per request and get an unlimited supply of clean rate-limit buckets.
   * `x-real-ip` replaced it and inherits exactly the same requirement.
   */
  it('ignores the forwarded header when nothing trustworthy is in front', () => {
    expect(resolveForwardedIdentifier({ ...spoofed, behindTrustedProxy: false })).toBe(
      '198.51.100.7',
    )
  })

  it('counts two forged headers from one socket as the same caller', () => {
    const from = (realIp: string) =>
      resolveForwardedIdentifier({ ...spoofed, realIp, behindTrustedProxy: false })

    expect(from('203.0.113.1')).toBe(from('203.0.113.2'))
  })

  it('believes the header once a proxy we control is in front', () => {
    expect(resolveForwardedIdentifier({ ...spoofed, behindTrustedProxy: true })).toBe(
      '203.0.113.99',
    )
  })

  /**
   * Bunny sends `x-forwarded-for` as *CDN address first, visitor second* — the
   * reverse of the usual convention. Reading the leftmost entry, which is what
   * this function used to do, would key every limit to a Bunny edge node and
   * put every visitor in one bucket. The header is not consulted at all, and
   * this test is what stops it being reintroduced as a "fallback".
   */
  it('does not consult x-forwarded-for, whatever it contains', () => {
    const withChain = {
      socketAddress: '198.51.100.7',
      realIp: undefined,
      behindTrustedProxy: true,
      // Present on the object but not in the type — deliberately unread.
      forwardedFor: '203.0.113.1, 70.41.3.18',
    } as Parameters<typeof resolveForwardedIdentifier>[0]

    expect(resolveForwardedIdentifier(withChain)).toBe('198.51.100.7')
  })

  it('never yields an empty identifier', () => {
    expect(
      resolveForwardedIdentifier({
        socketAddress: null,
        realIp: undefined,
        behindTrustedProxy: true,
      }),
    ).toBe('unknown')

    expect(
      resolveForwardedIdentifier({
        socketAddress: '198.51.100.7',
        realIp: '   ',
        behindTrustedProxy: true,
      }),
    ).toBe('198.51.100.7')
  })
})
