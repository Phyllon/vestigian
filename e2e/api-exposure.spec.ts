import { expect, test } from './helpers/fixtures'

/**
 * What the API refuses to hand to the internet, whatever the router in front of
 * it is or is not configured to do. See `server/utils/internal-request.ts` and
 * `server/utils/iiif-path.ts`.
 */
test.describe('the API in front of the proxy', () => {
  test('answers a scrape that reaches it directly', async ({ request }) => {
    const response = await request.get('/api/metrics')
    expect(response.status()).toBe(200)
  })

  test('hides the metrics from anything that came through a proxy', async ({ request }) => {
    const forwarded = await request.get('/api/metrics', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    })
    expect(forwarded.status()).toBe(404)

    const keyed = await request.get('/api/metrics', { headers: { 'x-origin-key': 'anything' } })
    expect(keyed.status()).toBe(404)
  })

  test('refuses a path that climbs out of the image service on the library proxy', async ({
    request,
  }) => {
    const traversal = await request.get('/api/columns/marcus-aurelius/tile/%2e%2e/%2e%2e/secret')
    expect(traversal.status()).toBe(400)
  })
})
