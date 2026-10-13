/**
 * Prometheus scrape target, read by Alloy over the Compose network.
 *
 * **Not intended to be publicly reachable.** Production exposes the app only
 * through Traefik, and the router denies this path there; what it would leak is
 * route names and traffic volumes rather than any data, but a scrape endpoint
 * is also a free way to make the process do work, hence the rate limit below as
 * a second line rather than the only one.
 *
 * The router rule is not the only thing standing in the way any more: the
 * handler itself answers 404 to anything that arrived through a proxy
 * (`isDirectRequest`). Alloy reaches this over the compose network with no
 * forwarding headers; every request from the internet carries some. That makes
 * the claim above true even if the Traefik file provider is not loaded — which
 * `docker/traefik/dynamic.yml` says it cannot confirm.
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
  // 404, not 403: the route is not announced to anyone who should not have it.
  if (!isDirectRequest(getRequestHeaders(event))) {
    throw createError({ statusCode: 404, message: 'Not found.' })
  }

  await enforceRateLimit(event, 'expensive')

  const registry = useMetrics()
  registerCatalogueMetrics()
  setResponseHeader(event, 'content-type', registry.contentType)
  setResponseHeader(event, 'cache-control', 'no-store')

  return registry.metrics()
})
