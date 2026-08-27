import { randomUUID } from 'node:crypto'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_URL_PATH,
} from '@opentelemetry/semantic-conventions'
import type { H3Event } from 'h3'
import type { Span } from '@opentelemetry/api'
import type { Logger } from 'pino'

/**
 * The request layer. Before this file the server had no per-request hook of any
 * kind — no correlation id, no access log, no place to hang a span — so every
 * question about a single request had to be answered by reasoning about the
 * code rather than by looking.
 *
 * Three things are attached here and nowhere else: an id that ties a request's
 * log lines together, a server span that its child spans nest inside, and the
 * latency observation behind every dashboard.
 */

declare module 'h3' {
  interface H3EventContext {
    requestId: string
    log: Logger
    startedAt: number
    span?: Span
    /** Guards against counting a request twice when it both responds and errors. */
    metricsRecorded?: boolean
  }
}

/**
 * The route *pattern*, which is the whole cardinality discipline in one
 * function. `/api/sites/61272` must be recorded as `/api/sites/:id`, or the
 * metric grows a series per site and Prometheus inherits the size of the atlas.
 *
 * `matchedRoute` is Nitro's own resolved pattern, so it stays correct as routes
 * are added. `unmatched` covers 404s, which would otherwise be the one path an
 * attacker could use to mint unbounded series by requesting random URLs.
 */
const resolveRouteLabel = (event: H3Event): string =>
  event.context.matchedRoute?.path ?? 'unmatched'

export default defineNitroPlugin((nitro) => {
  const tracingEnabled = startTracing()
  const log = useLogger()

  log.info({ tracing: tracingEnabled ? 'enabled' : 'disabled' }, 'observability ready')

  nitro.hooks.hook('request', (event) => {
    // An inbound id is honoured so a trace survives the proxy hop; ours is only
    // minted when nothing upstream supplied one.
    const requestId = getRequestHeader(event, 'x-request-id') ?? randomUUID()

    event.context.requestId = requestId
    event.context.startedAt = performance.now()
    event.context.log = createRequestLogger(requestId)

    setResponseHeader(event, 'x-request-id', requestId)

    if (!tracingEnabled) return

    // Named for the raw path here and renamed to the route pattern in
    // `beforeResponse`. Routing has not run yet at this point, so
    // `matchedRoute` is undefined and the pattern is simply not knowable —
    // naming it `unmatched` now and leaving it would make every trace in Tempo
    // called the same thing.
    //
    // `url.path` is set for the sampler, which reads this attribute rather than
    // the span name for exactly the same reason.
    const span = trace.getTracer('vestigia').startSpan(`${event.method} ${event.path}`, {
      kind: SpanKind.SERVER,
      attributes: {
        [ATTR_HTTP_REQUEST_METHOD]: event.method,
        [ATTR_URL_PATH]: event.path,
      },
    })

    event.context.span = span
  })

  nitro.hooks.hook('beforeResponse', (event, { body }) => {
    const startedAt = event.context.startedAt
    if (startedAt === undefined) return

    const durationSeconds = (performance.now() - startedAt) / 1000
    const route = resolveRouteLabel(event)
    const status = String(getResponseStatus(event))
    const labels = { route, method: event.method, status }

    httpRequestDuration().observe(labels, durationSeconds)
    httpRequestsTotal().inc(labels)
    event.context.metricsRecorded = true

    const span = event.context.span
    if (span) {
      // Now that routing has happened, the span can carry the pattern rather
      // than the path — so Tempo groups every site request together instead of
      // showing sixty thousand distinct operation names.
      span.updateName(`${event.method} ${route}`)
      span.setAttribute(ATTR_HTTP_ROUTE, route)
      span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, getResponseStatus(event))
      if (getResponseStatus(event) >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR })
      }
      span.end()
    }

    // The access log is `debug` for the tile route and `info` for everything
    // else. One map pan is dozens of tile requests, and at `info` they would
    // bury every line that a person actually needs to read.
    const level = route.startsWith('/api/tiles') ? 'debug' : 'info'

    event.context.log[level](
      {
        route,
        method: event.method,
        status: getResponseStatus(event),
        durationMs: Math.round(durationSeconds * 1000),
        // The same identity the rate limiter counts against, resolved by the
        // same function, so a log line and a 429 can never disagree about who
        // made the request. This is also what a log-driven blocker needs —
        // without it CrowdSec can see that something was refused but not by
        // whom, which makes a decision impossible.
        //
        // It is personal data. `REDACTED_FIELDS` in `logger.ts` and Loki's
        // retention are the whole of the position on that.
        ip: resolveClientIdentifier(event),
        userAgent: getRequestHeader(event, 'user-agent'),
        // Bytes matter here specifically: a tile is binary and its size is the
        // difference between an empty ocean tile and a dense one.
        bytes: body instanceof Buffer || body instanceof Uint8Array ? body.byteLength : undefined,
      },
      'request',
    )
  })

  nitro.hooks.hook('error', (error, { event }) => {
    const requestLog = event?.context.log ?? log
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500

    // A request that never matched a route never reaches `beforeResponse`, so
    // without this a burst of 404s — a broken link, or someone scanning for
    // admin panels — would leave no trace in the metrics at all. The route
    // label is still the matched pattern or the constant `unmatched`, so this
    // cannot be used to mint series by requesting random paths.
    if (event && !event.context.metricsRecorded) {
      httpRequestsTotal().inc({
        route: resolveRouteLabel(event),
        method: event.method,
        status: String(statusCode),
      })
      event.context.metricsRecorded = true
    }

    // 4xx is the client being told no, which is the system working. Only 5xx
    // and unclassified throws are ours to answer for.
    if (statusCode < 500) {
      requestLog.debug(
        { route: event ? resolveRouteLabel(event) : undefined, statusCode, message: error.message },
        'request refused',
      )
      return
    }

    requestLog.error(
      {
        route: event ? resolveRouteLabel(event) : undefined,
        statusCode,
        err: { message: error.message, stack: error.stack },
      },
      'request failed',
    )
  })

  nitro.hooks.hook('close', async () => {
    // Without this the batch processor is killed mid-flight and the spans that
    // describe a shutdown — the ones most worth having — are the ones lost.
    await shutdownTracing()
  })
})
