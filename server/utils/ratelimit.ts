import { createHmac, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'

export interface RateLimitPolicy {
  /** Requests permitted inside the window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
  /**
   * Count against a one-way pseudonym of the address instead of the address,
   * so the cache never holds an IP for this policy. See `pseudonymiseIdentifier`.
   */
  anonymise?: boolean
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
  /**
   * Browser timing beacons: a page load sends one batch, so this is generous for
   * a real visitor and cheap to refuse for anything stuffing the histograms.
   */
  vitals: { limit: 30, windowSeconds: 60, anonymise: true },
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
   * enough that browsing the map never notices.
   *
   * On its own this cap does not deliver what its own comment used to claim:
   * 300/min sustained is 18,000/hour, so enumerating all 61,272 records takes
   * ~3.4 hours, not days. `recordDaily` below is the number that actually
   * makes that claim true; this one stays wide because real bursts — a
   * moderator working the queue, a reader opening several results in a row —
   * legitimately need it.
   */
  record: { limit: 300, windowSeconds: 60 },
  /**
   * The sustained cap `record` alone cannot provide. 2,000/day is far beyond
   * any real reader's or moderator's daily total, but it puts a full-database
   * enumeration (61,272 records ÷ 2,000/day) at ~31 days for a single IP —
   * days to weeks, not hours. Checked in addition to `record`, never instead
   * of it, on the same five public, sequentially-addressed record routes.
   */
  recordDaily: { limit: 2000, windowSeconds: 86400 },
  /**
   * Endpoints that cost more than they look. `sitemap.xml` re-runs a
   * 50,000-row query and `ready` makes two Postgres round trips plus a Redis
   * ping — both unauthenticated, both trivially amplified.
   */
  expensive: { limit: 30, windowSeconds: 60 },
  /**
   * A second factor at login: matches `login`'s own brute-force resistance
   * level, by IP. A 6-digit TOTP code is a smaller space than a password, so
   * `verify-2fa.post.ts` also invalidates the whole login challenge outright
   * after 8 wrong attempts against *that* challenge specifically — this
   * policy is the IP-wide backstop, not the only guard.
   */
  twoFactorVerify: { limit: 8, windowSeconds: 900 },
  /**
   * The admin panel's reads. Wide, because the station is a dashboard that
   * refreshes several lists from one screen and an administrator working a
   * spam run legitimately reloads it hard — but not unlimited, because these
   * are the widest-reading endpoints in the app: `accounts.get.ts` returns
   * email addresses and `accounts/[id].get.ts` returns one person's complete
   * body of work, so a compromised admin session should still meet a ceiling
   * on how fast it can be used to enumerate the user table.
   */
  admin: { limit: 240, windowSeconds: 60 },
  /**
   * Re-authentication for a sanction. Matches `login`'s brute-force
   * resistance exactly, because it takes the same password — a step-up
   * endpoint with a looser cap than the login form would simply be the softer
   * of two doors onto the same credential.
   */
  adminStepUp: { limit: 8, windowSeconds: 900 },
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
  /** The peer we are actually talking to — the CDN edge, when there is one. */
  socketAddress: string | null
  /** `x-real-ip`, which Bunny sets to the visitor address and nothing else. */
  realIp: string | undefined
  /**
   * Whether a proxy we control is known to sit in front and to overwrite that
   * header. False means it is attacker-controlled and must be ignored.
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
 * The header is now believed only when something we control is known to be in
 * front and to overwrite it. Otherwise the socket address is the only honest
 * answer, even when it is a shared NAT address: over-counting a handful of
 * colleagues is a far smaller failure than counting nobody.
 *
 * **`x-forwarded-for` is deliberately not consulted.** Under Bunny it carries
 * the CDN address first and the visitor second — the reverse of the usual
 * convention — so the familiar "leftmost entry is the client" reading would key
 * every limit to a Bunny edge node and collapse every visitor behind one
 * bucket. `x-real-ip` carries the visitor and only the visitor, so there is no
 * position to get wrong.
 *
 * This still trusts the proxy chain itself. An attacker who bypasses the CDN
 * and reaches Traefik directly can forge the header again, so the origin must
 * accept connections only from the CDN's published ranges. That is a firewall
 * concern, not one this function can answer.
 */
export const resolveForwardedIdentifier = (request: ClientIdentityRequest): string => {
  const socketAddress = request.socketAddress ?? 'unknown'

  if (!request.behindTrustedProxy) return socketAddress

  return request.realIp?.trim() || socketAddress
}

export const resolveClientIdentifier = (event: H3Event): string =>
  resolveForwardedIdentifier({
    socketAddress: getRequestIP(event) ?? null,
    realIp: getRequestHeader(event, 'x-real-ip'),
    behindTrustedProxy: useRuntimeConfig().behindTrustedProxy === true,
  })

/**
 * A keyed one-way stand-in for an address: HMAC-SHA256 under a secret that
 * exists only in this process's memory, cut to 16 hex characters.
 *
 * It is stable inside one process lifetime, which is all a rate limit needs,
 * and cannot be turned back into an address from what Valkey holds — the key
 * is not stored anywhere and is gone on restart, and without it the 2^32
 * IPv4 space cannot be enumerated against the hash. It is **not** a
 * long-lived identifier: it changes at every deploy, so it cannot be used to
 * follow a visitor over time even by whoever could read the cache.
 */
const PROCESS_SECRET = randomBytes(32)

export const pseudonymiseIdentifier = (
  identifier: string,
  secret: Buffer = PROCESS_SECRET,
): string => createHmac('sha256', secret).update(identifier).digest('hex').slice(0, 16)

/**
 * Counts the request against `name` and refuses it with a 429 once the policy
 * is spent.
 *
 * Resolves to the decision for an allowed request, so a caller that wants to
 * tell the person how close they are (the sign-in form warns before the last
 * attempts) can. It resolves to `undefined` when the cache is unreachable and
 * the policy was **not applied** — "unknown" must not read as "plenty left", so
 * callers treat `undefined` as "say nothing".
 */
export const enforceRateLimit = async (
  event: H3Event,
  name: RateLimitName,
): Promise<RateLimitDecision | undefined> => {
  const policy: RateLimitPolicy = RATE_LIMITS[name]
  const now = Date.now()
  const address = resolveClientIdentifier(event)
  const key = buildRateLimitKey({
    name,
    identifier: policy.anonymise ? pseudonymiseIdentifier(address) : address,
    windowSeconds: policy.windowSeconds,
    now,
  })

  let count: number
  try {
    const redis = useRedis()
    count = await redis.incr(key)
    if (count === 1) await redis.expire(key, policy.windowSeconds)
  } catch (error) {
    // Fail open: a cache outage should not lock every visitor out of the site.
    //
    // Which means that for as long as Valkey is unreachable, *every* policy in
    // `RATE_LIMITS` is absent — including the four signups an hour that
    // `register.post.ts` names as its defence against account farming. That was
    // previously a bare `catch {}` and left no trace anywhere; this line and
    // the `failed_open` counter are the only evidence it ever happened, and the
    // `RateLimiterFailingOpen` alert watches the counter.
    rateLimitDecisionsTotal().inc({ policy: name, outcome: 'failed_open' })
    useLogger().error(
      { policy: name, err: { message: (error as Error).message } },
      'rate limit not applied: cache unreachable',
    )
    return
  }

  const decision = evaluateRateLimit({ count, policy, now })

  if (decision.allowed) {
    rateLimitDecisionsTotal().inc({ policy: name, outcome: 'allowed' })
    return decision
  }

  rateLimitDecisionsTotal().inc({ policy: name, outcome: 'blocked' })

  // A refused request is the single most useful event a log-driven detector can
  // read, and it used to be invisible: the 429 below lands in the error hook
  // under 500, which logs `request refused` at `debug` without the policy name.
  event.context.log?.warn(
    { audit: 'ratelimit.blocked', policy: name, count, limit: policy.limit },
    'rate limit exceeded',
  )

  // h3 types `retry-after` as a number; it stringifies the value itself.
  setResponseHeader(event, 'retry-after', decision.retryAfterSeconds)
  throw createError({
    statusCode: 429,
    statusMessage: 'Too many requests',
    message: `Too many attempts. Try again in ${decision.retryAfterSeconds} seconds.`,
    // Structured, so the interface can show its own translated wording and a
    // countdown instead of echoing this English sentence. `message` stays for
    // API clients that only read it.
    data: { retryAfterSeconds: decision.retryAfterSeconds, policy: name },
  })
}
