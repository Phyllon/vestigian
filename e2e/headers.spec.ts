import { expect, test } from './helpers/fixtures'

/**
 * Guards the exact bug this suite's `README.md` warns about: invisible in
 * `nuxt dev`, real only in the built output. `nuxt-security` (2.6.0) silently
 * drops `Strict-Transport-Security` from every response whose only matching
 * `routeRules` entry is its own injected `/**` — which was every route in
 * this app — confirmed by curling a running production build directly, not
 * by reading the module's source. A unit test cannot see this: the failure
 * lives in how Nitro's compiled route-rules table is built at build time and
 * applied at request time, neither of which vitest ever constructs. Only a
 * real request against `.output/server` can.
 *
 * No `page.goto` anywhere here on purpose — every assertion is about response
 * headers, which exist before a single byte of the body is parsed, so this
 * whole file runs at API-request speed rather than browser speed.
 */

test.describe('security headers', () => {
  test('a route with no cache-control rule of its own gets the private, no-store default, plus HSTS and CORP', async ({
    request,
  }) => {
    const response = await request.get('/api/health')
    expect(response.headers()['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin')
  })

  test('a rendered page gets the same defaults as an API route', async ({ request }) => {
    // `/licence` reads no session and touches no viewer-specific state, but the
    // defaults apply regardless of that — this is the header floor, not an
    // exception for pages that happen to be safe to cache.
    const response = await request.get('/licence')
    expect(response.headers()['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin')
  })

  test('a route with its own cache-control rule keeps it, not the default', async ({ request }) => {
    // Set directly in `sites.geojson.get.ts` via `setResponseHeaders`, after
    // `server/middleware/security-defaults.ts` has already run — proves the
    // middleware's "only when nothing set one yet" check doesn't clobber a
    // handler that sets cache-control itself, and that the two mechanisms
    // resolve in the right order in the actual built server.
    const response = await request.get('/api/data/sites.geojson?limit=1')
    expect(response.headers()['cache-control']).toBe('public, max-age=300')
    // Still gets HSTS and CORP — those aren't conditional on anything.
    expect(response.headers()['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
    expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin')
  })

  test('a tile response is publicly cacheable, not private', async ({ request }) => {
    // `/api/tiles/**`'s routeRule, not the middleware's default — a wildcard
    // route rule and a plain `routeRules['/api/tiles/**']` entry are two
    // different Nitro mechanisms, and only a real request proves they combine
    // rather than one silently winning outright.
    const response = await request.get('/api/tiles/0/0/0')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    )
    expect(response.headers()['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
  })
})
