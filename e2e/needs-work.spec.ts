import { expect, test } from './helpers/fixtures'

/**
 * The contribution queue — "what can I do near here".
 *
 * The endpoint is the part worth guarding: it takes a coordinate from an
 * untrusted caller, runs a geography query against sixty thousand rows, and its
 * ordering decides where real people walk. Asserted against the production
 * build, because the bounding-box pre-filter that keeps it off a sequential
 * scan is invisible in a unit test.
 */

const ENDPOINT = '/api/sites/needs-work'

/** Xanten on the Lower Rhine — dense with recorded sites in the real catalogue. */
const ORIGIN = { lon: 6.45, lat: 51.66 }

interface NeedsWorkItem {
  slug: string
  title: string
  distanceMetres: number
  score: number
  missing: string[]
}

const fetchItems = async (
  request: { get: (url: string) => Promise<{ ok: () => boolean; json: () => Promise<unknown> }> },
  query: string,
): Promise<NeedsWorkItem[]> => {
  const response = await request.get(`${ENDPOINT}?${query}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { items: NeedsWorkItem[] }).items
}

test.describe('needs-work endpoint', () => {
  test('returns nearby sites ordered by distance', async ({ request }) => {
    const items = await fetchItems(request, `lon=${ORIGIN.lon}&lat=${ORIGIN.lat}&radius=25000`)

    expect(items.length).toBeGreaterThan(0)

    // Distance is the binding constraint on somebody standing somewhere; a very
    // incomplete site forty kilometres away is not more useful than a nearly
    // complete one at the end of the road.
    const distances = items.map((item) => item.distanceMetres)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })

  test('never returns a site outside the requested radius', async ({ request }) => {
    const radius = 5000
    const items = await fetchItems(request, `lon=${ORIGIN.lon}&lat=${ORIGIN.lat}&radius=${radius}`)

    for (const item of items) expect(item.distanceMetres).toBeLessThanOrEqual(radius)
  })

  /**
   * The whole point of the list. A record with nothing missing must not appear,
   * or a contributor is sent to a site that wants nothing from them.
   */
  test('only lists records that are actually missing something', async ({ request }) => {
    const items = await fetchItems(request, `lon=${ORIGIN.lon}&lat=${ORIGIN.lat}&radius=25000`)

    for (const item of items) {
      expect(item.missing.length).toBeGreaterThan(0)
      expect(item.score).toBeLessThan(1)
    }
  })

  test('?missing=photograph returns only sites that have none', async ({ request }) => {
    const items = await fetchItems(
      request,
      `lon=${ORIGIN.lon}&lat=${ORIGIN.lat}&radius=25000&missing=photograph`,
    )

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item.missing).toContain('photograph')
  })

  test('lists the most valuable gap first, so the top one is the best thing to do', async ({
    request,
  }) => {
    const items = await fetchItems(
      request,
      `lon=${ORIGIN.lon}&lat=${ORIGIN.lat}&radius=25000&missing=photograph`,
    )

    for (const item of items) expect(item.missing[0]).toBe('photograph')
  })

  test('refuses a coordinate that is not one', async ({ request }) => {
    expect((await request.get(`${ENDPOINT}?lon=999&lat=51.6`)).status()).toBe(400)
    expect((await request.get(`${ENDPOINT}?lat=51.6`)).status()).toBe(400)
  })

  /**
   * The radius is what bounds the work this endpoint does. Left open, a caller
   * could ask for the whole continent and turn a lookup into a table scan.
   */
  test('refuses a radius beyond the cap', async ({ request }) => {
    expect(
      (
        await request.get(`${ENDPOINT}?lon=${ORIGIN.lon}&lat=${ORIGIN.lat}&radius=5000000`)
      ).status(),
    ).toBe(400)
  })
})

test.describe('nearby page', () => {
  test('explains itself and asks before reading a location', async ({ page }) => {
    await page.goto('/nearby')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // The location button must be an explicit action: the page may not read a
    // coordinate without being asked.
    await expect(page.getByRole('button', { name: /location/i })).toBeVisible()
  })

  test('stays out of search results', async ({ page }) => {
    await page.goto('/nearby')

    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveAttribute('content', /noindex/)
  })
})
