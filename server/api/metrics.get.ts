/**
 * Prometheus scrape target, read by Alloy over the Compose network.
 *
 * **Not intended to be publicly reachable.** Production exposes the app only
 * through Traefik, and the router denies this path there; what it would leak is
 * route names and traffic volumes rather than any data, but a scrape endpoint
 * is also a free way to make the process do work, hence the rate limit below as
 * a second line rather than the only one.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')

  const registry = useMetrics()
  setResponseHeader(event, 'content-type', registry.contentType)
  setResponseHeader(event, 'cache-control', 'no-store')

  return registry.metrics()
})
