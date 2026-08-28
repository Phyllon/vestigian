import { expect, test } from './helpers/fixtures'
import { IMGPROXY_OVER_HTTP, watchForProblems } from './helpers/console'

const SITE_PATH = '/api/data/sites.geojson?limit=1'

test.describe('a site record', () => {
  test('opens by slug and renders its title', async ({ page, request }) => {
    const feed = await (await request.get(SITE_PATH)).json()
    const properties = feed.features[0].properties as { slug: string; title: string }

    // The gallery's images are refused in this configuration only — see
    // IMGPROXY_OVER_HTTP. Every other CSP refusal is still a failure.
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })
    await page.goto(`/site/${properties.slug}`)

    await expect(page.getByRole('heading', { level: 1, name: properties.title })).toBeVisible()
    expect(problems.cspViolations, 'the site page reported CSP violations').toEqual([])
  })

  test('answers the same record by slug and by id', async ({ request }) => {
    const feed = await (await request.get(SITE_PATH)).json()
    const { slug } = feed.features[0].properties as { slug: string }

    const bySlug = await (await request.get(`/api/sites/slug/${slug}`)).json()
    const byId = await (await request.get(`/api/sites/${bySlug.id}`)).json()

    // Both routes share `loadSiteDetail`. They used to differ: the slug route
    // re-entered Nitro over HTTP, which had no socket address and therefore
    // counted every visitor into one rate-limit bucket.
    expect(byId).toEqual(bySlug)
  })

  test('gives an unknown slug a 404, not a 500', async ({ request }) => {
    const response = await request.get('/api/sites/slug/there-is-no-such-place-here')
    expect(response.status()).toBe(404)
  })

  test('refuses a malformed identifier before it reaches the database', async ({ request }) => {
    for (const bad of ['abc', '-1', '0', '9999999999999999999999']) {
      const response = await request.get(`/api/sites/${bad}`)
      expect([400, 404], `/api/sites/${bad} answered ${response.status()}`).toContain(
        response.status(),
      )
    }
  })

  test('never publishes an image whose licence forbids it', async ({ request }) => {
    const feed = await (await request.get('/api/data/sites.geojson?limit=40')).json()

    for (const feature of feed.features.slice(0, 12)) {
      const site = await (await request.get(`/api/sites/${feature.properties.id}`)).json()
      for (const image of site.images ?? []) {
        // `UNKNOWN` and `ARR` are filtered server-side; an image reaching the
        // client with either is a licence breach, not a rendering bug.
        expect(['UNKNOWN', 'ARR']).not.toContain(image.licence)
        expect(image.licence, 'an image arrived with no licence at all').toBeTruthy()
      }
    }
  })
})

test.describe('the public data feed', () => {
  test('is CORS-open, because it is meant to be reused', async ({ request }) => {
    const response = await request.get('/api/data/sites.geojson?limit=5')
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['access-control-allow-origin']).toBe('*')

    const body = await response.json()
    expect(body.type).toBe('FeatureCollection')
    expect(body.features.length).toBeGreaterThan(0)
    expect(body.features[0].geometry.type).toBe('Point')
  })

  test('rejects a malformed bounding box', async ({ request }) => {
    const response = await request.get('/api/data/sites.geojson?bbox=not-a-box')
    expect(response.status()).toBe(400)
  })
})
