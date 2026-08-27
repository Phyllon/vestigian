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
  /**
   * Generous, because a cache hit costs nothing and most requests are hits.
   * The upstream services are the constraint, not us: Wikidata's search
   * endpoint answered "You are making too many requests" after eight calls
   * spaced 800ms apart, so a miss is throttled by the Valkey layer rather than
   * by this number.
   */
  enrichment: { limit: 60, windowSeconds: 60 },
  /**
   * Signup challenges. Generous enough to survive a reload or three, tight
   * enough that the endpoint is not a free source of solvable puzzles.
   */
  challenge: { limit: 20, windowSeconds: 3600 },
  /**
   * Password reset, split out of the `register` bucket it used to share.
   * Four signup attempts should not also exhaust someone's ability to recover
   * their account.
   */
  passwordReset: { limit: 5, windowSeconds: 3600 },
  /**
   * Full records: `sites/:id`, `sites/slug/:slug`, the revision lists and both
   * tracing routes. These had no limit at all, which made them the widest
   * scraping surface in the app — the complete text of a record, addressed by
   * sequential integer ids, with every slug published in the sitemap. High
   * enough that browsing the map never notices; low enough that enumerating
   * 61,272 records takes days rather than minutes.
   */
  record: { limit: 300, windowSeconds: 60 },
  /**
   * Endpoints that cost more than they look. `sitemap.xml` re-runs a
   * 50,000-row query and `ready` makes two Postgres round trips plus a Redis
   * ping — both unauthenticated, both trivially amplified.
   */
  expensive: { limit: 30, windowSeconds: 60 },
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

export interface ClientIdentityRequest {
  /** The peer we are actually talking to — a proxy, when there is one. */
  socketAddress: string | null
  forwardedFor: string | undefined
  cloudflareIp: string | undefined
  /**
   * Whether a proxy we control is known to sit in front and to overwrite these
   * headers. False means they are attacker-controlled and must be ignored.
   */
  behindTrustedProxy: boolean
}

/**
 * Who to count a request against.
 *
 * This used to take `cf-connecting-ip` whenever it was present, which is only
 * safe if the request genuinely arrived through Cloudflare. Nothing checked
 * that. Any client that could reach the origin could set the header to a fresh
 * value per request and mint itself an unlimited supply of clean rate-limit
 * buckets — which made every policy in `RATE_LIMITS` advisory, including the
 * four-per-hour on signup that the registration endpoint cites as its defence
 * against account farming.
 *
 * Forwarded headers are now believed only when something we control is known
 * to be in front and to overwrite them. Otherwise the socket address is the
 * only honest answer, even when it is a shared NAT address: over-counting a
 * handful of colleagues is a far smaller failure than counting nobody.
 *
 * This still trusts the proxy chain itself. An attacker who bypasses
 * Cloudflare and reaches Traefik directly can forge the header again, so the
 * origin should accept connections only from the CDN's ranges. That is a
 * firewall concern, not one this function can answer.
 */
export const resolveForwardedIdentifier = (request: ClientIdentityRequest): string => {
  const socketAddress = request.socketAddress ?? 'unknown'

  if (!request.behindTrustedProxy) return socketAddress

  if (request.cloudflareIp) return request.cloudflareIp

  // Only the leftmost entry is the original client; the rest of the chain is
  // appended by intermediaries and is not ours to believe.
  const firstForwarded = request.forwardedFor?.split(',')[0]?.trim()
  return firstForwarded || socketAddress
}

export const resolveClientIdentifier = (event: H3Event): string =>
  resolveForwardedIdentifier({
    socketAddress: getRequestIP(event) ?? null,
    forwardedFor: getRequestHeader(event, 'x-forwarded-for'),
    cloudflareIp: getRequestHeader(event, 'cf-connecting-ip'),
    behindTrustedProxy: useRuntimeConfig().behindTrustedProxy === true,
  })

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
