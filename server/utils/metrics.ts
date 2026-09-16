import { Counter, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client'

/**
 * Every metric the app exports, declared in one place so the cardinality of the
 * whole set can be read at a glance.
 *
 * **The rule that matters here is that no label may carry an identifier.** Not
 * a site id, not a slug, not a tile coordinate, not a user id, not an IP. Each
 * distinct label combination is a stored time series, so labelling by site
 * would turn 61,272 records into 61,272 series and put Prometheus, not the map,
 * on the critical path for memory. The bounded dimensions below — a route
 * pattern, a cache result, a rate-limit policy name — are all drawn from fixed
 * vocabularies that exist in the code.
 */

let registry: Registry | undefined

export const useMetrics = (): Registry => {
  if (!registry) {
    registry = new Registry()
    // Heap, event-loop lag, GC pauses, open handles. The cheapest early warning
    // there is that something is wrong inside the process rather than around it.
    collectDefaultMetrics({ register: registry })
  }
  return registry
}

/** Declared lazily so the registry exists before anything registers against it. */
const define = <T>(build: (registers: Registry[]) => T): (() => T) => {
  let metric: T | undefined
  return () => {
    metric ??= build([useMetrics()])
    return metric
  }
}

/**
 * Latency and volume by **route pattern**, never by path. `/api/sites/:id`,
 * not `/api/sites/61272` — Nitro exposes the matched route on the event, which
 * is the difference between eleven series and sixty thousand.
 */
export const httpRequestDuration = define(
  (registers) =>
    new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Request latency by matched route.',
      labelNames: ['route', 'method', 'status'] as const,
      // Tuned to this app: a cached tile answers in single-digit milliseconds,
      // an enrichment miss can take seconds. Linear buckets would put almost
      // every request in the first one and tell you nothing.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers,
    }),
)

export const httpRequestsTotal = define(
  (registers) =>
    new Counter({
      name: 'http_requests_total',
      help: 'Requests by matched route and status.',
      labelNames: ['route', 'method', 'status'] as const,
      registers,
    }),
)

/**
 * The tile path, split by the two things that decide what it costs: which query
 * `planTileRender` chose, and whether Valkey answered.
 */
export const tileRequestsTotal = define(
  (registers) =>
    new Counter({
      name: 'tile_requests_total',
      help: 'Tile requests by render strategy and cache result.',
      labelNames: ['strategy', 'cache'] as const,
      registers,
    }),
)

export const tileRenderDuration = define(
  (registers) =>
    new Histogram({
      name: 'tile_render_duration_seconds',
      help: 'Time spent in PostGIS building a tile, cache misses only.',
      labelNames: ['strategy'] as const,
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers,
    }),
)

/**
 * The most important series in this file.
 *
 * `enforceRateLimit` fails open when Valkey is unreachable, which means a cache
 * outage silently removes every limit in `RATE_LIMITS` — including the four
 * signups an hour that `register.post.ts` cites as its defence against account
 * farming. `outcome="failed_open"` is the only signal that has happened, and it
 * is what the `RateLimiterFailingOpen` alert watches.
 */
export const rateLimitDecisionsTotal = define(
  (registers) =>
    new Counter({
      name: 'rate_limit_decisions_total',
      help: 'Rate limit decisions by policy. failed_open means the limit was not applied.',
      labelNames: ['policy', 'outcome'] as const,
      registers,
    }),
)

export const enrichmentRequestsTotal = define(
  (registers) =>
    new Counter({
      name: 'enrichment_requests_total',
      help: 'Upstream enrichment lookups by source and outcome.',
      labelNames: ['source', 'outcome'] as const,
      registers,
    }),
)

export const translationRequestsTotal = define(
  (registers) =>
    new Counter({
      name: 'translation_requests_total',
      help: 'LibreTranslate calls by outcome. Translation fails open, so failures are invisible without this.',
      labelNames: ['outcome'] as const,
      registers,
    }),
)

/** Governance, counted. Who did it belongs in the log line, not in a label. */
export const moderationActionsTotal = define(
  (registers) =>
    new Counter({
      name: 'moderation_actions_total',
      help: 'Moderator actions by kind.',
      labelNames: ['action'] as const,
      registers,
    }),
)

export const contributionRevisionsTotal = define(
  (registers) =>
    new Counter({
      name: 'contribution_revisions_total',
      help: 'Submitted revisions by entity type and whether they published immediately.',
      labelNames: ['kind', 'status'] as const,
      registers,
    }),
)

/**
 * Delivery is deliberately swallowed by `sendTokenMail` — a provider outage
 * must not turn `forgot-password` into an oracle that answers 500 for a
 * registered address and 200 for an unknown one. This counter is the only
 * thing left that says the mail never went out.
 */
export const mailDeliveriesTotal = define(
  (registers) =>
    new Counter({
      name: 'mail_deliveries_total',
      help: 'Transactional mail by purpose, transport and outcome.',
      labelNames: ['purpose', 'transport', 'outcome'] as const,
      registers,
    }),
)

export const authEventsTotal = define(
  (registers) =>
    new Counter({
      name: 'auth_events_total',
      help: 'Authentication outcomes.',
      labelNames: ['event', 'outcome'] as const,
      registers,
    }),
)
