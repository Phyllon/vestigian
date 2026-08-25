import type { H3Event } from 'h3'

export interface RateLimitPolicy {
  /** Requests permitted inside the window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Named policies rather than inline numbers, so the cost of an endpoint is
 * stated in one place and reviewed as a whole.
 */
export const RATE_LIMITS = {
  login: { limit: 8, windowSeconds: 900 },
  register: { limit: 4, windowSeconds: 3600 },
  contribute: { limit: 30, windowSeconds: 3600 },
  upload: { limit: 20, windowSeconds: 3600 },
  search: { limit: 120, windowSeconds: 60 },
  tiles: { limit: 1200, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>

export type RateLimitName = keyof typeof RATE_LIMITS

interface RateLimitKeyInput {
  name: RateLimitName
  identifier: string
  windowSeconds: number
  now: number
}

/**
 * Fixed-window key. The window index is folded into the key so expiry is
 * handled by Redis TTL rather than by a sweep, and the counter cannot drift.
 */
export const buildRateLimitKey = (input: RateLimitKeyInput): string => {
  const window = Math.floor(input.now / (input.windowSeconds * 1000))
  return `rl:${input.name}:${input.identifier}:${window}`
}

interface RateLimitEvaluation {
  count: number
  policy: RateLimitPolicy
  now: number
}

export const evaluateRateLimit = (input: RateLimitEvaluation): RateLimitDecision => {
  const { count, policy, now } = input
  const windowMs = policy.windowSeconds * 1000
  const elapsed = now % windowMs
  return {
    allowed: count <= policy.limit,
    remaining: Math.max(policy.limit - count, 0),
    retryAfterSeconds: Math.ceil((windowMs - elapsed) / 1000),
  }
}

/**
 * Identify the caller. Behind Traefik or Cloudflare the socket address is the
 * proxy, so the forwarded header is preferred — but only its first entry, since
 * the rest is client-supplied and trivially spoofed.
 */
export const resolveClientIdentifier = (event: H3Event): string => {
  const forwarded = getRequestHeader(event, 'x-forwarded-for')
  const real = getRequestHeader(event, 'cf-connecting-ip')
  if (real) return real
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return getRequestIP(event) ?? 'unknown'
}

export const enforceRateLimit = async (event: H3Event, name: RateLimitName): Promise<void> => {
  const policy = RATE_LIMITS[name]
  const now = Date.now()
  const key = buildRateLimitKey({
    name,
    identifier: resolveClientIdentifier(event),
    windowSeconds: policy.windowSeconds,
    now,
  })

  let count: number
  try {
    const redis = useRedis()
    count = await redis.incr(key)
    if (count === 1) await redis.expire(key, policy.windowSeconds)
  } catch {
    // Fail open: a cache outage should not lock every visitor out of the site.
    return
  }

  const decision = evaluateRateLimit({ count, policy, now })
  if (decision.allowed) return

  // h3 types `retry-after` as a number; it stringifies the value itself.
  setResponseHeader(event, 'retry-after', decision.retryAfterSeconds)
  throw createError({
    statusCode: 429,
    statusMessage: 'Too many requests',
    message: `Too many attempts. Try again in ${decision.retryAfterSeconds} seconds.`,
  })
}
