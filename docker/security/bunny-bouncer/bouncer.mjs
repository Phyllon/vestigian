#!/usr/bin/env node
/**
 * The enforcement half CrowdSec's own engine cannot provide (see
 * docker/security/README.md — "Enforcement — not done by any of the above").
 * The engine reads Vestigian's logs and decides who is abusive; nothing
 * applies that decision until something reads the decision stream and acts on
 * it. This is that something, aimed at the Bunny edge rather than Traefik,
 * because everything on the origin box — CrowdSec, Traefik's own limiter, the
 * Valkey rate limits in server/utils/ratelimit.ts — runs *after* a request has
 * already paid for a TCP connection and a TLS handshake. Blocking at Bunny
 * means an L7 flood never reaches the origin at all.
 *
 * Deliberately dependency-free: Node 22 ships global fetch, and this is a
 * ~150-line poller, not an application. No package.json, no node_modules, no
 * build step — `docker build` here is one COPY and a CMD.
 *
 * What it does, every POLL_INTERVAL_SECONDS:
 *   1. GET the CrowdSec LAPI decision stream (new bans in, expired bans out).
 *   2. Maintain the current set of banned IPs in memory, pruning anything
 *      past its own expiry as a second line of defence against a missed
 *      "deleted" entry.
 *   3. Make the pull zone's own blocked-IP list match that set, one
 *      `addBlockedIp` / `removeBlockedIp` call per difference, paced and
 *      capped per cycle.
 *
 * Why the blocked-IP list and not an Edge Rule. The first version mirrored the
 * ban set onto one Edge Rule's RemoteIP trigger. Against a real account every
 * manual call succeeded while the automated poller failed with "Maximum 5
 * triggers are allowed per condition" — an error unrelated to what was sent,
 * never root-caused. The blocked-IP list needs no rule model, no enum values
 * and no Guid bookkeeping: both endpoints take `{ "BlockedIp": "<ip>" }`
 * (checked against Bunny's API reference, 2026-10-03). The cost is one call per
 * IP instead of one per change, which is what CALL_SPACING_MS,
 * MAX_CALLS_PER_CYCLE and the 429 handling are for.
 *
 * Only IP-scoped `ban` decisions are acted on. Range (CIDR) and country-scope
 * decisions are logged and skipped. Bunny's reference says nothing about IPv6
 * or CIDR on these endpoints, so an address Bunny rejects is logged once and
 * skipped, not retried.
 *
 * **Still unproven against the live API:** that a listed IP is actually refused
 * at the edge (the test is in the bouncer step of
 * documents/runbook_prod.deployment.md), that the per-IP calls survive a real
 * burst without a 429, and how many entries the list accepts. Bunny documents
 * none of those.
 *
 * Ownership of the list: see PRUNE_UNKNOWN below.
 */

// http, not https: this is the default for the `crowdsec` hostname on the
// compose network's internal Docker DNS, never a public address — TLS on a
// container-to-container hop inside the same host offers nothing here.
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const LAPI_URL = (process.env.CROWDSEC_LAPI_URL ?? 'http://crowdsec:8080').replace(/\/$/, '')
const BOUNCER_KEY = process.env.CROWDSEC_BOUNCER_KEY
const BUNNY_API_KEY = process.env.BUNNY_API_KEY
const BUNNY_PULL_ZONE_ID = process.env.BUNNY_PULL_ZONE_ID
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS ?? 15)

for (const [name, value] of Object.entries({ BOUNCER_KEY, BUNNY_API_KEY, BUNNY_PULL_ZONE_ID })) {
  if (!value) {
    console.error(
      `[bunny-bouncer] missing required env var for ${name} — refusing to start with no way to authenticate.`,
    )
    process.exit(1)
  }
}

// `message` is already fully interpolated into the template literal — the
// one argument the rule below worries about substituting a format specifier
// into — before it ever reaches console.log/warn; `extra` is logged as a
// second, independent value, never used to fill a placeholder in the first.
const log = (message, extra = {}) =>
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
  console.log(`[bunny-bouncer] ${message}`, Object.keys(extra).length ? extra : '')

const warn = (message, extra = {}) =>
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
  console.warn(`[bunny-bouncer] ${message}`, Object.keys(extra).length ? extra : '')

/**
 * CrowdSec durations look like `3h59m59.999967836s` or, for an already-expired
 * decision, `-59m59s`. Only the magnitude matters here — a negative duration
 * is pruned on the very next tick either way — so the sign is dropped rather
 * than threaded through the rest of the parse.
 */
const parseCrowdSecDuration = (raw) => {
  // Three optional non-capturing groups, each requiring a distinct trailing
  // literal (h/m/s) with nothing overlapping between them — no ambiguous
  // backtracking path despite the plugin's star-height heuristic flagging it.
  // eslint-disable-next-line security/detect-unsafe-regex
  const match = /^-?(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(raw ?? '')
  if (!match) return null

  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = Number(match[3] ?? 0)
  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000
  return Number.isFinite(totalMs) && totalMs > 0 ? totalMs : null
}

/** CrowdSec's own default ban length, used only when a duration fails to parse
 * — logged every time, since it should never actually happen. */
const FALLBACK_BAN_MS = 4 * 60 * 60 * 1000

/** ip → expiry epoch ms. */
const bannedUntil = new Map()

const pruneExpired = (now) => {
  for (const [ip, expiresAt] of bannedUntil) {
    if (expiresAt <= now) bannedUntil.delete(ip)
  }
}

const applyDecisions = (decisions, { removing }) => {
  const now = Date.now()

  for (const decision of decisions ?? []) {
    if (decision.scope?.toLowerCase() !== 'ip') {
      log('skipping non-IP decision scope', { scope: decision.scope, value: decision.value })
      continue
    }
    if (decision.type !== 'ban') continue

    if (removing) {
      bannedUntil.delete(decision.value)
      continue
    }

    const durationMs = parseCrowdSecDuration(decision.duration)
    if (durationMs === null) {
      warn('could not parse decision duration, using the 4h fallback', {
        ip: decision.value,
        duration: decision.duration,
      })
    }
    bannedUntil.set(decision.value, now + (durationMs ?? FALLBACK_BAN_MS))
  }
}

let seenFirstStream = false

const fetchLapiDecisions = async () => {
  const url = new URL('/v1/decisions/stream', LAPI_URL)
  if (!seenFirstStream) url.searchParams.set('startup', 'true')

  const response = await fetch(url, { headers: { 'X-Api-Key': BOUNCER_KEY } })
  if (!response.ok) {
    throw new Error(`LAPI stream returned ${response.status}: ${await response.text()}`)
  }

  seenFirstStream = true
  return response.json()
}

const bunnyHeaders = { AccessKey: BUNNY_API_KEY, 'content-type': 'application/json' }
const BUNNY_API = `https://api.bunny.net/pullzone/${BUNNY_PULL_ZONE_ID}`

/** Thrown for a Bunny response worth reacting to rather than just logging. */
class BunnyRateLimited extends Error {
  constructor(retryAfterSeconds) {
    super(`Bunny answered 429, retry after ${retryAfterSeconds}s`)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const callBunny = async (path, body) => {
  const response = await fetch(`${BUNNY_API}${path}`, {
    method: 'POST',
    headers: bunnyHeaders,
    body: JSON.stringify(body),
  })
  if (response.status === 429) {
    throw new BunnyRateLimited(Number(response.headers.get('retry-after')) || 30)
  }
  if (!response.ok) {
    throw new Error(`Bunny ${path} returned ${response.status}: ${await response.text()}`)
  }
}

/** The pull zone's own blocked-IP list, as Bunny currently holds it. */
const fetchBunnyBlockedIps = async () => {
  const response = await fetch(BUNNY_API, { headers: bunnyHeaders })
  if (!response.ok) {
    throw new Error(`Bunny pull zone lookup returned ${response.status}: ${await response.text()}`)
  }
  const pullZone = await response.json()
  return new Set(pullZone.BlockedIps ?? [])
}

const blockOnBunny = (ip) => callBunny('/addBlockedIp', { BlockedIp: ip })
const unblockOnBunny = (ip) => callBunny('/removeBlockedIp', { BlockedIp: ip })

/** What Bunny is believed to hold *because this process put it there*. Seeded
 * from the pull zone at startup (see `reconcileAtStartup`) and then kept in
 * step call by call, so a failed call leaves the set truthful rather than
 * optimistic and the next cycle retries only the difference. */
const onBunny = new Set()

/** IPs Bunny refused with a 4xx. Remembered so one malformed or unsupported
 * address (the docs say nothing about IPv6 or CIDR) is logged once rather than
 * retried every cycle forever. Cleared when CrowdSec stops listing the IP. */
const refused = new Set()

/** Pause between consecutive Bunny calls, and the most calls per cycle. The
 * earlier design was one Edge Rule rewritten in full on every change; this one
 * is a call per IP, so a burst of decisions is spread over cycles instead of
 * hitting Bunny's (undocumented) limit in one go. */
const CALL_SPACING_MS = 250
const MAX_CALLS_PER_CYCLE = 40

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The pull zone's blocked-IP list is shared state: an operator may have added
 * entries by hand in the Bunny dashboard. By default those are left alone and
 * only reported. After a restart, entries this process added earlier are
 * indistinguishable from manual ones, so a ban that expired while the bouncer
 * was down stays on Bunny until BUNNY_PRUNE_UNKNOWN=true is set — which makes
 * this process the sole owner of the list and removes anything CrowdSec does
 * not currently ban. Choose that only if nobody maintains the list by hand.
 */
const PRUNE_UNKNOWN = process.env.BUNNY_PRUNE_UNKNOWN === 'true'

const reconcileAtStartup = async () => {
  const existing = await fetchBunnyBlockedIps()
  const unmanaged = [...existing].filter((ip) => !bannedUntil.has(ip))

  for (const ip of existing) {
    if (bannedUntil.has(ip) || PRUNE_UNKNOWN) onBunny.add(ip)
  }
  if (unmanaged.length > 0) {
    log(
      PRUNE_UNKNOWN
        ? 'pull zone holds IPs CrowdSec does not ban — they will be removed'
        : 'pull zone holds IPs CrowdSec does not ban — left alone (BUNNY_PRUNE_UNKNOWN is not true)',
      { count: unmanaged.length },
    )
  }
}

/** One synchronisation pass: make `onBunny` equal to the CrowdSec ban set,
 * oldest difference first, within MAX_CALLS_PER_CYCLE. Returns how many
 * differences remain so the caller knows whether to poll again promptly. */
const synchroniseWithBunny = async () => {
  for (const ip of refused) {
    if (!bannedUntil.has(ip)) refused.delete(ip)
  }

  const toBlock = [...bannedUntil.keys()].filter((ip) => !onBunny.has(ip) && !refused.has(ip))
  const toUnblock = [...onBunny].filter((ip) => !bannedUntil.has(ip))
  const work = [
    ...toUnblock.map((ip) => ({ ip, apply: unblockOnBunny, done: () => onBunny.delete(ip) })),
    ...toBlock.map((ip) => ({ ip, apply: blockOnBunny, done: () => onBunny.add(ip) })),
  ]

  let calls = 0
  for (const { ip, apply, done } of work) {
    if (calls >= MAX_CALLS_PER_CYCLE) break
    if (calls > 0) await wait(CALL_SPACING_MS)
    calls += 1
    try {
      await apply(ip)
      done()
    } catch (error) {
      if (error instanceof BunnyRateLimited) throw error
      // A 4xx on one address must not stall every other ban behind it.
      warn('Bunny refused one address, skipping it until CrowdSec stops listing it', {
        ip,
        message: error.message,
      })
      refused.add(ip)
    }
  }

  if (calls > 0) log('synchronised with Bunny', { calls, blockedOnBunny: onBunny.size })
  return work.length - calls
}

/** Retries with a fixed backoff rather than crash-looping the container —
 * Docker's own restart policy would otherwise hide a slow-starting CrowdSec
 * or Bunny outage behind an endless stream of exits. */
const waitUntilReachable = async () => {
  for (;;) {
    try {
      await fetchLapiDecisions()
      seenFirstStream = false // that call must not consume the real startup snapshot
      await fetchBunnyBlockedIps()
      return
    } catch (error) {
      warn('not ready yet, retrying in 10s', { message: error.message })
      await wait(10_000)
    }
  }
}

let running = true
process.on('SIGTERM', () => {
  log('received SIGTERM, stopping after the current cycle')
  running = false
})

// Caps exponential backoff after repeated failures. Rate limiting by Bunny was
// the working theory for the original failure (2026-09-29: every isolated
// manual call succeeded, the poller failed consistently), so this stays: long
// enough for a transient Bunny-side issue to clear, short enough that a real
// recovery is noticed the same day.
const MAX_BACKOFF_SECONDS = 300

const main = async () => {
  log('starting', { LAPI_URL, BUNNY_PULL_ZONE_ID, POLL_INTERVAL_SECONDS, PRUNE_UNKNOWN })
  await waitUntilReachable()
  log('LAPI and Bunny both reachable')

  // The startup snapshot has to land in `bannedUntil` before reconciling, or
  // every existing ban would look "unknown".
  const snapshot = await fetchLapiDecisions()
  applyDecisions(snapshot.new, { removing: false })
  await reconcileAtStartup()

  let consecutiveFailures = 0
  let backlog = 0

  while (running) {
    let rateLimitedForSeconds = 0
    try {
      const { new: added, deleted } = await fetchLapiDecisions()
      applyDecisions(deleted, { removing: true })
      applyDecisions(added, { removing: false })
      pruneExpired(Date.now())

      backlog = await synchroniseWithBunny()
      consecutiveFailures = 0
    } catch (error) {
      // Fails open, the same way server/utils/ratelimit.ts does on a Valkey
      // outage: a broken bouncer must degrade to "not blocking", never to
      // "the site is down", since CrowdSec is defence-in-depth on top of the
      // rate limits that already run inside the app.
      consecutiveFailures += 1
      if (error instanceof BunnyRateLimited) rateLimitedForSeconds = error.retryAfterSeconds
      warn('cycle failed, backing off', { message: error.message, consecutiveFailures })
    }

    // A backlog (more differences than one cycle's call budget) is worked off
    // at the normal poll interval, not backed off — nothing has failed.
    const backoffSeconds =
      consecutiveFailures > 0
        ? Math.min(
            Math.max(POLL_INTERVAL_SECONDS * 2 ** consecutiveFailures, rateLimitedForSeconds),
            MAX_BACKOFF_SECONDS,
          )
        : POLL_INTERVAL_SECONDS
    if (backlog > 0) log('differences remain, continuing next cycle', { backlog })
    await wait(backoffSeconds * 1000)
  }
}

await main()
