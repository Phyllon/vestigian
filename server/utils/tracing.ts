import {
  SpanStatusCode,
  context as otelContext,
  trace,
  type Attributes,
  type Context,
  type Link,
  type Span,
  type SpanKind,
  type Tracer,
} from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_URL_PATH,
} from '@opentelemetry/semantic-conventions'
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-node'

/**
 * Tracing, wired by hand rather than by `auto-instrumentations-node`.
 *
 * That is a deliberate refusal, for three reasons that all point the same way.
 * ESM auto-instrumentation needs a loader hook registered before any
 * instrumented module is imported, which means `node --import` — but the
 * runtime image ships only `.output` (see `docker/Dockerfile`), so a
 * root-level bootstrap file would have no `node_modules` to resolve against.
 * `postgres.js` has no OpenTelemetry instrumentation package in any case; `pg`
 * has one, and this project does not use `pg`. And the rest of the outbound
 * I/O is confined to four files that already funnel through singletons, so
 * automatic patching would buy a dependency tree and almost no coverage.
 *
 * What that costs: spans exist only where `withSpan` is called. What it buys:
 * no loader hook, no Dockerfile change, and everything inside the Nitro bundle.
 */

let provider: NodeTracerProvider | undefined
let tracer: Tracer | undefined

/**
 * Full detail everywhere except the tile route.
 *
 * A single map pan is dozens of tile requests, so at 100% the traces would be
 * almost entirely tiles — the one path whose behaviour is already visible in
 * `tile_requests_total` and the cache hit rate. Sampling it down keeps the
 * traces that answer questions metrics cannot.
 *
 * The decision reads the **`url.path` attribute, not the span name**, and that
 * is not a stylistic choice. Sampling happens when a span is created, which in
 * Nitro is before routing has run — `matchedRoute` is still undefined at that
 * point, so every span is named for an unmatched route. Keying on the name
 * therefore matched nothing and quietly traced every tile at full rate. The raw
 * path is on the event from the start, so the request hook puts it in the
 * attributes for this function to read.
 *
 * `ParentBased` wraps this so a sampled request stays sampled through every
 * child span rather than producing a trace with holes in it.
 */
const createTileAwareSampler = (tileRatio: number): Sampler => {
  // Typed as the interface, not as the concrete classes: `AlwaysOnSampler`
  // declares `shouldSample()` with no parameters and the ratio sampler with
  // two, so calling either through its own type with the interface's six
  // arguments does not compile.
  const everythingElse: Sampler = new AlwaysOnSampler()
  const tiles: Sampler = new TraceIdRatioBasedSampler(tileRatio)

  return {
    /*
     * Six parameters against a house maximum of three, because this is
     * OpenTelemetry's `Sampler` interface rather than our own signature — the
     * shape is not ours to choose, and narrowing it would mean not implementing
     * the interface.
     */
    // eslint-disable-next-line max-params
    shouldSample: (
      context: Context,
      traceId: string,
      spanName: string,
      spanKind: SpanKind,
      attributes: Attributes,
      links: Link[],
    ): SamplingResult => {
      const path = attributes[ATTR_URL_PATH]
      const isTile = typeof path === 'string' && path.startsWith('/api/tiles/')
      const sampler = isTile ? tiles : everythingElse
      return sampler.shouldSample(context, traceId, spanName, spanKind, attributes, links)
    },
    toString: () => `TileAware{tiles=${tileRatio}}`,
  }
}

/**
 * Starts the SDK, or does nothing at all.
 *
 * An unset endpoint is an ordinary state, not a misconfiguration: the collector
 * is optional infrastructure and the app must serve without it exactly as it
 * serves without LibreTranslate. Returns whether tracing is live so the caller
 * can say so once at startup instead of leaving it to be guessed.
 */
export const startTracing = (): boolean => {
  if (provider) return true

  const { telemetry } = useRuntimeConfig()
  if (!telemetry.otlpEndpoint) return false

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: telemetry.serviceName,
      [ATTR_SERVICE_VERSION]: process.env.IMAGE_TAG ?? 'dev',
    }),
    sampler: new ParentBasedSampler({
      root: createTileAwareSampler(telemetry.tileSampleRatio),
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${telemetry.otlpEndpoint}/v1/traces` })),
    ],
  })

  provider.register()
  tracer = trace.getTracer(telemetry.serviceName)
  return true
}

export const shutdownTracing = async (): Promise<void> => {
  await provider?.shutdown()
  provider = undefined
  tracer = undefined
}

export interface SpanOptions {
  /** Bounded values only — never an id, a slug or a coordinate. */
  attributes?: Attributes
  /**
   * The request's server span, from `event.context.span`.
   *
   * Passed explicitly because it cannot be inherited. The server span is opened
   * in Nitro's `request` hook and closed in `beforeResponse` — two separate
   * callbacks, so there is no call stack to wrap in `context.with()` and no
   * ambient active span for a handler to pick up. Without this every child span
   * became its own root trace: sixty tile requests produced sixty orphaned
   * `postgis.render_tile` traces instead of nesting inside three sampled ones,
   * and because a root span is sampled on its own attributes, they also escaped
   * the tile sampling entirely.
   */
  parent?: Span | null
}

/**
 * Runs `work` inside a span, or just runs it when tracing is off.
 *
 * The span is closed and its error recorded on both paths, so a caller never
 * has to remember `end()` in a `finally`. Errors are re-thrown untouched:
 * this observes, it does not handle.
 */
export const withSpan = async <T>(
  name: string,
  work: (span: Span | null) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> => {
  if (!tracer) return work(null)

  const parentContext = options.parent
    ? trace.setSpan(otelContext.active(), options.parent)
    : otelContext.active()

  return tracer.startActiveSpan(
    name,
    { attributes: options.attributes },
    parentContext,
    async (span) => {
      try {
        const result = await work(span)
        span.end()
        return result
      } catch (error) {
        span.recordException(error as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message })
        span.end()
        throw error
      }
    },
  )
}

/** The active trace id, for stamping onto a log line so the two can be joined. */
export const currentTraceId = (): string | undefined => {
  const context = trace.getActiveSpan()?.spanContext()
  return context?.traceId
}
