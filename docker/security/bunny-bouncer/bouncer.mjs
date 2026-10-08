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
 * Only `ban` decisions from ENFORCED_ORIGINS are acted on. Bunny holds at most
 * 100 blocked entries per pull zone (found live, 2026-10-08; the API reference
 * is silent), so the community blocklist cannot be mirrored. Single IPv4 and
 * IPv6 addresses were confirmed to block at the edge on 2026-10-08. Ranges go
 * through `toBunnyPattern` (IPv4 /16 and /24 only, as Bunny's `a.b.c.*`
 * wildcard); anything else is logged and skipped. An entry Bunny rejects is
 * logged once and skipped, not retried.
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

/**
 * One JSON object per line, so Alloy ships it to Loki and the security
 * dashboard can `| json` it. The earlier `console.log(message, object)` form
 * printed long objects across several lines, which Loki stores as separate,
 * unparseable entries. `message` is a constant at every call site; the
 * variable parts are in `extra` and cannot act as format specifiers because
 * JSON.stringify produces the only argument.
 */
const log = (message, extra = {}) =>
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
  console.log(JSON.stringify({ level: 'info', msg: message, ...extra }))

const warn = (message, extra = {}) =>
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
  console.warn(JSON.stringify({ level: 'warn', msg: message, ...extra }))

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

/**
 * Which decision origins reach Bunny. Bunny caps a pull zone's blocked-IP list
 * at 100 entries (found live 2026-10-08: `The Pull Zone already has 100
 * blocked IPs.`; the API reference does not say so), while the community
 * blocklist CrowdSec pulls in as `CAPI`/`lists` is thousands of addresses. The
 * edge can only hold the handful of IPs this deployment's own scenarios
 * convicted (`crowdsec`) or an operator banned by hand (`cscli`); the rest stay
 * enforceable only by a bouncer that lives on the origin.
 */
const ENFORCED_ORIGINS = new Set(
  (process.env.BUNNY_ENFORCED_ORIGINS ?? 'crowdsec,cscli').split(',').map((o) => o.trim()),
)

/** Bunny's documented-by-error limit on `BlockedIps` per pull zone. */
const BUNNY_MAX_BLOCKED_IPS = Number(process.env.BUNNY_MAX_BLOCKED_IPS ?? 100)

/** ip → expiry epoch ms. */
const bannedUntil = new Map()

const pruneExpired = (now) => {
  for (const [ip, expiresAt] of bannedUntil) {
    if (expiresAt <= now) bannedUntil.delete(ip)
  }
}

/**
 * The string Bunny's blocked-IP list should hold for a decision, or null when
 * it cannot be expressed there. Bunny matches `a.b.c.*` wildcards, so an IPv4
 * range maps onto them only where the prefix falls on an octet boundary: /24
 * becomes `a.b.c.*`, /16 becomes `a.b.*`. /8 is refused on purpose — one wrong
 * decision would lock out a sixth of the internet's worth of addresses, and
 * CrowdSec's own scenarios never produce one. A range whose host bits are not
 * zero is refused too, rather than quietly widened or narrowed. IPv6 ranges are
 * skipped: Bunny's blocked-IP list rejected both `x:x:x:x:*` and `x:x:x:x::/64`
 * when tried by hand (2026-10-08).
 */
const ALIGNED_IPV4_PREFIXES = new Set([16, 24])
// Anchored, bounded digit groups separated by literals — no nested quantifiers.
const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/

const toBunnyPattern = (decision) => {
  const scope = decision.scope?.toLowerCase()
  if (scope === 'ip') return decision.value
  if (scope !== 'range') return null

  const match = IPV4_CIDR.exec(decision.value ?? '')
  if (!match) return null
  const prefix = Number(match[5])
  if (!ALIGNED_IPV4_PREFIXES.has(prefix)) return null

  const octets = match.slice(1, 5)
  const keptOctets = prefix / 8
  if (octets.slice(keptOctets).some((octet) => octet !== '0')) return null
  return [...octets.slice(0, keptOctets), '*'].join('.')
}

const applyDecisions = (decisions, { removing }) => {
  const now = Date.now()

  for (const decision of decisions ?? []) {
    if (decision.type !== 'ban' || !ENFORCED_ORIGINS.has(decision.origin)) continue

    const pattern = toBunnyPattern(decision)
    if (pattern === null) {
      log('skipping a decision Bunny cannot express', {
        scope: decision.scope,
        value: decision.value,
      })
      continue
    }

    if (removing) {
      if (bannedUntil.delete(pattern)) log('decision ended', { pattern, origin: decision.origin })
      continue
    }

    const durationMs = parseCrowdSecDuration(decision.duration)
    if (durationMs === null) {
      warn('could not parse decision duration, using the 4h fallback', {
        value: decision.value,
        duration: decision.duration,
      })
    }
    if (!bannedUntil.has(pattern)) {
      log('decision received', {
        pattern,
        origin: decision.origin,
        scenario: decision.scenario,
        duration: decision.duration,
      })
    }
    bannedUntil.set(pattern, now + (durationMs ?? FALLBACK_BAN_MS))
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
 * from the pull zone at startup (see `reconcileWithBunny`) and then kept in
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

/** How often Bunny's list is re-read and compared with CrowdSec. The decision
 * stream reports changes, never state, so a removal missed once (a restart, an
 * outage, a failed call) would otherwise stand until the next restart. */
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000

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

/** Entries on Bunny that this process does not own (see PRUNE_UNKNOWN). They
 * still count against Bunny's cap, so capacity is computed with them. */
let unmanagedOnBunny = 0

const reconcileWithBunny = async () => {
  const existing = await fetchBunnyBlockedIps()
  onBunny.clear()
  const unmanaged = [...existing].filter((ip) => !bannedUntil.has(ip))
  unmanagedOnBunny = PRUNE_UNKNOWN ? 0 : unmanaged.length

  for (const ip of existing) {
    if (bannedUntil.has(ip) || PRUNE_UNKNOWN) onBunny.add(ip)
  }
  if (unmanaged.length > 0) {
    log(
      PRUNE_UNKNOWN
        ? 'pull zone holds IPs CrowdSec does not ban — removing them'
        : 'pull zone holds IPs CrowdSec does not ban — left alone (BUNNY_PRUNE_UNKNOWN is not true)',
      { count: unmanaged.length },
    )
  }

  // Also the bouncer's heartbeat: it runs at startup and every
  // RECONCILE_INTERVAL_MS, and the security dashboard alerts on its absence and
  // plots `blockedOnBunny` against Bunny's 100-entry cap.
  log('reconciled with Bunny', {
    blockedOnBunny: existing.size,
    unmanaged: unmanaged.length,
    enforcedBans: bannedUntil.size,
    cap: BUNNY_MAX_BLOCKED_IPS,
  })
}

/** So the "list is full" warning is logged when the shortfall changes, not on
 * every poll. */
let lastReportedNotEnforced = 0

/** What to remove and what to add this cycle. Removals free slots first;
 * whatever does not fit under Bunny's cap is not tried, rather than tried and
 * refused one 400 at a time. */
const planChanges = () => {
  const toUnblock = [...onBunny].filter((ip) => !bannedUntil.has(ip))
  const freeSlots = Math.max(
    0,
    BUNNY_MAX_BLOCKED_IPS - unmanagedOnBunny - (onBunny.size - toUnblock.length),
  )
  const wanted = [...bannedUntil.keys()].filter((ip) => !onBunny.has(ip) && !refused.has(ip))
  const toBlock = wanted.slice(0, freeSlots)

  const notEnforced = wanted.length - toBlock.length
  if (notEnforced > 0 && notEnforced !== lastReportedNotEnforced) {
    warn('Bunny blocked-IP list is full, not enforcing every ban at the edge', {
      notEnforced,
      cap: BUNNY_MAX_BLOCKED_IPS,
      unmanagedOnBunny,
    })
  }
  lastReportedNotEnforced = notEnforced

  return { toUnblock, toBlock }
}

/** One Bunny call. A rate limit propagates (the loop backs off); any other
 * refusal is confined to this address so it cannot stall the bans behind it. */
const applyChange = async ({ ip, apply, done }) => {
  try {
    await apply(ip)
    done()
    log(apply === blockOnBunny ? 'blocked at Bunny' : 'unblocked at Bunny', { ip })
  } catch (error) {
    if (error instanceof BunnyRateLimited) throw error
    warn('Bunny refused one address, skipping it until CrowdSec stops listing it', {
      ip,
      message: error.message,
    })
    refused.add(ip)
  }
}

/** One synchronisation pass: make `onBunny` equal to the CrowdSec ban set,
 * oldest difference first, within MAX_CALLS_PER_CYCLE. Returns how many
 * differences remain so the caller knows whether to poll again promptly. */
const synchroniseWithBunny = async () => {
  for (const ip of refused) {
    if (!bannedUntil.has(ip)) refused.delete(ip)
  }

  const { toUnblock, toBlock } = planChanges()
  const work = [
    ...toUnblock.map((ip) => ({ ip, apply: unblockOnBunny, done: () => onBunny.delete(ip) })),
    ...toBlock.map((ip) => ({ ip, apply: blockOnBunny, done: () => onBunny.add(ip) })),
  ]

  let calls = 0
  for (const change of work) {
    if (calls >= MAX_CALLS_PER_CYCLE) break
    if (calls > 0) await wait(CALL_SPACING_MS)
    calls += 1
    await applyChange(change)
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

const reconcileWhenDue = async (lastReconciledAt) => {
  if (Date.now() - lastReconciledAt < RECONCILE_INTERVAL_MS) return lastReconciledAt
  await reconcileWithBunny()
  return Date.now()
}

const main = async () => {
  log('starting', { LAPI_URL, BUNNY_PULL_ZONE_ID, POLL_INTERVAL_SECONDS, PRUNE_UNKNOWN })
  await waitUntilReachable()
  log('LAPI and Bunny both reachable')

  // The startup snapshot has to land in `bannedUntil` before reconciling, or
  // every existing ban would look "unknown".
  const snapshot = await fetchLapiDecisions()
  applyDecisions(snapshot.new, { removing: false })
  await reconcileWithBunny()

  let consecutiveFailures = 0
  let backlog = 0
  let lastReconciledAt = Date.now()

  while (running) {
    let rateLimitedForSeconds = 0
    try {
      const { new: added, deleted } = await fetchLapiDecisions()
      applyDecisions(deleted, { removing: true })
      applyDecisions(added, { removing: false })
      pruneExpired(Date.now())

      lastReconciledAt = await reconcileWhenDue(lastReconciledAt)

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
