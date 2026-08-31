import { expect, test } from './helpers/fixtures'

const SITE_PATH = '/api/data/sites.geojson?limit=1'

/** Pulls every `<loc>…</loc>` value out of a sitemap XML body. */
const extractLocs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!)

test.describe('sitemap', () => {
  test('the index points at valid child sitemaps', async ({ request }) => {
    const indexResponse = await request.get('/sitemap.xml')
    expect(indexResponse.ok()).toBeTruthy()
    const indexXml = await indexResponse.text()
    expect(indexXml).toContain('<sitemapindex')

    const childUrls = extractLocs(indexXml)
    expect(childUrls.length).toBeGreaterThan(0)

    const childResponse = await request.get(new URL(childUrls[0]!).pathname)
    expect(childResponse.ok()).toBeTruthy()
    const childXml = await childResponse.text()
    expect(childXml).toContain('<urlset')
    expect(extractLocs(childXml).length).toBeGreaterThan(0)
  })

  test('lists tracings, previously missing entirely', async ({ request }) => {
    const indexXml = await (await request.get('/sitemap.xml')).text()
    const tracingsSitemap = extractLocs(indexXml).find((url) => url.includes('sitemap-tracings'))
    expect(tracingsSitemap, 'no sitemap-tracings child listed in the index').toBeTruthy()

    const tracingsXml = await (await request.get(new URL(tracingsSitemap!).pathname)).text()
    const tracingUrls = extractLocs(tracingsXml)
    expect(tracingUrls.length).toBeGreaterThan(0)
    expect(tracingUrls[0]).toContain('/tracing/')
  })
})

test.describe('robots.txt', () => {
  test('disallows auth and edit routes, and points at the sitemap', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text()
    expect(body).toContain('Disallow: /login')
    expect(body).toContain('Disallow: /site/*/edit')
    expect(body).toContain('Disallow: /tracing/*/edit')
    expect(body).toMatch(/Sitemap: .*\/sitemap\.xml/)
  })
})

test.describe('page metadata', () => {
  test('a site page carries a canonical link, OG image and valid Place JSON-LD', async ({
    page,
    request,
  }) => {
    const feed = await (await request.get(SITE_PATH)).json()
    const { slug } = feed.features[0].properties as { slug: string }

    await page.goto(`/site/${slug}`)

    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveAttribute('href', new RegExp(`/site/${slug}$`))

    const ogImage = page.locator('meta[property="og:image"]')
    await expect(ogImage).toHaveAttribute('content', /.+/)

    const jsonLdBodies = await page.locator('script[type="application/ld+json"]').allTextContents()
    const parsed = jsonLdBodies.map((body) => JSON.parse(body))
    const place = parsed.find((item) => item['@type'] === 'Place')
    expect(place, 'no Place JSON-LD found on the site page').toBeTruthy()

    const html = page.locator('html')
    await expect(html).toHaveAttribute('lang', 'en')
  })

  test('a tracing page now carries a description and OG tags', async ({ page, request }) => {
    const indexXml = await (await request.get('/sitemap.xml')).text()
    const tracingsSitemap = extractLocs(indexXml).find((url) => url.includes('sitemap-tracings'))
    const tracingsXml = await (await request.get(new URL(tracingsSitemap!).pathname)).text()
    const tracingUrl = extractLocs(tracingsXml)[0]!
    const tracingPath = new URL(tracingUrl).pathname

    await page.goto(tracingPath)

    const description = page.locator('meta[name="description"]')
    await expect(description).toHaveAttribute('content', /.+/)

    const ogImage = page.locator('meta[property="og:image"]')
    await expect(ogImage).toHaveAttribute('content', /.+/)
  })

  test('a login page is marked noindex', async ({ page }) => {
    await page.goto('/login')
    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta).toHaveAttribute('content', /noindex/)
  })
})
