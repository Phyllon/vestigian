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
 * means an L7 flood never reaches Hetzner at all.
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
 *   3. When that set has actually changed, push the whole thing to Bunny as
 *      one Edge Rule's RemoteIP trigger, rather than one rule per IP — Bunny
 *      does not document a rule-count ceiling generous enough to risk the
 *      other design, and one rule is one API call regardless of ban count.
 *
 * Only IP-scoped `ban` decisions are acted on. Range (CIDR) and country-scope
 * decisions are logged and skipped — Bunny's RemoteIP trigger matches literal
 * addresses, and translating a CIDR into the right pattern shape is unverified
 * against the live API, so this does not guess.
 *
 * The Bunny Edge Rule field values below (ActionType 4 = BlockRequest, Trigger
 * Type 5 = RemoteIP, PatternMatchingType 0 = match any of PatternMatches) come
 * from Bunny's own API reference, not from a request made against a real
 * account — there is no Bunny account to test against from this environment.
 * **Before trusting this in production**, run the verification in the
 * "5. CrowdSec-Bouncer" section of .plans/runbook_prod.deployment.md: add a
 * decision for a test IP, confirm curl gets a 403 through Bunny, then remove
 * it. If PatternMatchingType 0 turns out to mean something else, that step is
 * where it is caught, not in front of real traffic.
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

/** Marks the one Edge Rule this process owns, so a restart finds and reuses it
 * instead of accumulating duplicates. Nothing else on the pull zone should use
 * this string as its Description. */
const EDGE_RULE_DESCRIPTION = 'crowdsec-bouncer-managed'

const BUNNY_ACTION_BLOCK_REQUEST = 4
const BUNNY_TRIGGER_REMOTE_IP = 5
const BUNNY_PATTERN_MATCH_ANY = 0

for (const [name, value] of Object.entries({ BOUNCER_KEY, BUNNY_API_KEY, BUNNY_PULL_ZONE_ID })) {
  if (!value) {
    console.error(
      `[bunny-bouncer] missing required env var for ${name} — refusing to start with no way to authenticate.`,
    )
    process.exit(1)
  }
}

const log = (message, extra = {}) =>
  console.log(`[bunny-bouncer] ${message}`, Object.keys(extra).length ? extra : '')

const warn = (message, extra = {}) =>
  console.warn(`[bunny-bouncer] ${message}`, Object.keys(extra).length ? extra : '')

/**
 * CrowdSec durations look like `3h59m59.999967836s` or, for an already-expired
 * decision, `-59m59s`. Only the magnitude matters here — a negative duration
 * is pruned on the very next tick either way — so the sign is dropped rather
 * than threaded through the rest of the parse.
 */
const parseCrowdSecDuration = (raw) => {
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

/** Finds the rule this process manages, if a previous run already created one
 * — makes a container restart idempotent instead of piling up duplicate rules. */
const findManagedRuleGuid = async () => {
  const response = await fetch(`https://api.bunny.net/pullzone/${BUNNY_PULL_ZONE_ID}`, {
    headers: bunnyHeaders,
  })
  if (!response.ok) {
    throw new Error(`Bunny pull zone lookup returned ${response.status}: ${await response.text()}`)
  }

  const pullZone = await response.json()
  const managed = (pullZone.EdgeRules ?? []).find(
    (rule) => rule.Description === EDGE_RULE_DESCRIPTION,
  )
  return managed?.Guid ?? null
}

const pushBannedIpsToBunny = async (ips) => {
  const guid = await findManagedRuleGuid()

  const body = {
    Guid: guid,
    ActionType: BUNNY_ACTION_BLOCK_REQUEST,
    Triggers: [
      {
        Type: BUNNY_TRIGGER_REMOTE_IP,
        PatternMatches: ips.length > 0 ? ips : ['0.0.0.0'],
        PatternMatchingType: BUNNY_PATTERN_MATCH_ANY,
      },
    ],
    TriggerMatchingType: BUNNY_PATTERN_MATCH_ANY,
    Description: EDGE_RULE_DESCRIPTION,
    // Disabled rather than deleted when there is nothing to block, so the
    // Guid survives for the next update and the rule's own history stays on
    // one object in the Bunny dashboard.
    Enabled: ips.length > 0,
  }

  const response = await fetch(
    `https://api.bunny.net/pullzone/${BUNNY_PULL_ZONE_ID}/edgerules/addOrUpdate`,
    { method: 'POST', headers: bunnyHeaders, body: JSON.stringify(body) },
  )

  if (!response.ok) {
    throw new Error(`Bunny edge rule update returned ${response.status}: ${await response.text()}`)
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Retries with a fixed backoff rather than crash-looping the container —
 * Docker's own restart policy would otherwise hide a slow-starting CrowdSec
 * or Bunny outage behind an endless stream of exits. */
const waitUntilReachable = async () => {
  for (;;) {
    try {
      await fetchLapiDecisions()
      seenFirstStream = false // that call must not consume the real startup snapshot
      await findManagedRuleGuid()
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

const main = async () => {
  log('starting', { LAPI_URL, BUNNY_PULL_ZONE_ID, POLL_INTERVAL_SECONDS })
  await waitUntilReachable()
  log('LAPI and Bunny both reachable')

  let lastPushedKey = null

  while (running) {
    try {
      const { new: added, deleted } = await fetchLapiDecisions()
      applyDecisions(deleted, { removing: true })
      applyDecisions(added, { removing: false })
      pruneExpired(Date.now())

      const ips = [...bannedUntil.keys()].sort()
      const key = ips.join(',')

      if (key !== lastPushedKey) {
        await pushBannedIpsToBunny(ips)
        log('pushed updated ban list to Bunny', { count: ips.length })
        lastPushedKey = key
      }
    } catch (error) {
      // Fails open, the same way server/utils/ratelimit.ts does on a Valkey
      // outage: a broken bouncer must degrade to "not blocking", never to
      // "the site is down", since CrowdSec is defence-in-depth on top of the
      // rate limits that already run inside the app.
      warn('cycle failed, will retry next interval', { message: error.message })
    }

    await wait(POLL_INTERVAL_SECONDS * 1000)
  }
}

await main()
