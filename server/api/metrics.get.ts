/**
 * Prometheus scrape target, read by Alloy over the Compose network.
 *
 * **Not intended to be publicly reachable.** Production exposes the app only
 * through Traefik, and the router denies this path there; what it would leak is
 * route names and traffic volumes rather than any data, but a scrape endpoint
 * is also a free way to make the process do work, hence the rate limit below as
 * a second line rather than the only one.
 */
defineRouteMeta({
  openAPI: {
    tags: ['system'],
    summary: 'Prometheus scrape target',
    description:
      'Not intended to be publicly reachable — denied at the Traefik router in production. Read by Alloy over the compose network.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')

  const registry = useMetrics()
  registerCatalogueMetrics()
  setResponseHeader(event, 'content-type', registry.contentType)
  setResponseHeader(event, 'cache-control', 'no-store')

  return registry.metrics()
})
