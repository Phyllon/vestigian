import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRateLimitKey,
  enforceRateLimit,
  evaluateRateLimit,
  pseudonymiseIdentifier,
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

describe('pseudonymiseIdentifier', () => {
  const secret = Buffer.from('a'.repeat(32))

  it('never contains the address it stands for', () => {
    const pseudonym = pseudonymiseIdentifier('203.0.113.9', secret)
    expect(pseudonym).not.toContain('203')
    expect(pseudonym).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is stable for one secret and different for different addresses', () => {
    expect(pseudonymiseIdentifier('203.0.113.9', secret)).toBe(
      pseudonymiseIdentifier('203.0.113.9', secret),
    )
    expect(pseudonymiseIdentifier('203.0.113.9', secret)).not.toBe(
      pseudonymiseIdentifier('203.0.113.10', secret),
    )
  })

  it('changes with the secret, so a restart breaks any linkage', () => {
    expect(pseudonymiseIdentifier('203.0.113.9', secret)).not.toBe(
      pseudonymiseIdentifier('203.0.113.9', Buffer.from('b'.repeat(32))),
    )
  })

  it('is what the anonymous measurement policy asks for', () => {
    expect(RATE_LIMITS.vitals.anonymise).toBe(true)
  })
})

describe('enforceRateLimit', () => {
  // The Nitro auto-imports `enforceRateLimit` reaches for, replaced by stand-ins.
  const incr = vi.fn()
  const expire = vi.fn()
  const setResponseHeader = vi.fn()
  const decisionsInc = vi.fn()
  const logError = vi.fn()
  const event = { context: { log: { warn: vi.fn() } } } as never

  beforeAll(() => {
    vi.stubGlobal('getRequestIP', () => '203.0.113.9')
    vi.stubGlobal('getRequestHeader', () => undefined)
    vi.stubGlobal('useRuntimeConfig', () => ({ behindTrustedProxy: false }))
    vi.stubGlobal('useRedis', () => ({ incr, expire }))
    vi.stubGlobal('rateLimitDecisionsTotal', () => ({ inc: decisionsInc }))
    vi.stubGlobal('useLogger', () => ({ error: logError }))
    vi.stubGlobal('setResponseHeader', setResponseHeader)
    vi.stubGlobal('createError', (input: { message: string }) =>
      Object.assign(new Error(input.message), input),
    )
  })

  afterAll(() => vi.unstubAllGlobals())

  beforeEach(() => vi.clearAllMocks())

  it('resolves to the decision for an allowed request, so a form can warn before the limit', async () => {
    incr.mockResolvedValue(6)

    const decision = await enforceRateLimit(event, 'login')

    // login allows 8: the sixth request leaves two.
    expect(decision).toMatchObject({ allowed: true, remaining: RATE_LIMITS.login.limit - 6 })
    expect(decisionsInc).toHaveBeenCalledWith({ policy: 'login', outcome: 'allowed' })
  })

  it('sets the expiry on the first request of a window and only then', async () => {
    incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    await enforceRateLimit(event, 'login')
    await enforceRateLimit(event, 'login')

    expect(expire).toHaveBeenCalledOnce()
    expect(expire).toHaveBeenCalledWith(expect.stringContaining('rl:login:'), 900)
  })

  it('refuses the request over the limit with a 429 that carries the wait as data', async () => {
    incr.mockResolvedValue(RATE_LIMITS.login.limit + 1)

    const refusal = await enforceRateLimit(event, 'login').then(
      () => null,
      (error: unknown) =>
        error as Error & {
          statusCode: number
          data: { retryAfterSeconds: number; policy: string }
        },
    )

    expect(refusal?.statusCode).toBe(429)
    expect(refusal?.data.policy).toBe('login')
    expect(refusal?.data.retryAfterSeconds).toBeGreaterThan(0)
    expect(refusal?.data.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMITS.login.windowSeconds)
    // The header and the body must agree: clients read either.
    expect(setResponseHeader).toHaveBeenCalledWith(
      event,
      'retry-after',
      refusal?.data.retryAfterSeconds,
    )
    expect(decisionsInc).toHaveBeenCalledWith({ policy: 'login', outcome: 'blocked' })
  })

  it('fails open when the cache is down, and resolves to undefined — unknown is not "plenty left"', async () => {
    incr.mockRejectedValue(new Error('connection refused'))

    const decision = await enforceRateLimit(event, 'login')

    expect(decision).toBeUndefined()
    expect(decisionsInc).toHaveBeenCalledWith({ policy: 'login', outcome: 'failed_open' })
    expect(logError).toHaveBeenCalledOnce()
  })
})
