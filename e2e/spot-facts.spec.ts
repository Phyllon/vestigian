import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { toggleOverlay, waitForMapReady, waitForTiles } from './helpers/map'

/**
 * The "about this spot" block in a reference mark's info box.
 *
 * Needs the ports import (`pnpm import:ports`) to have run — the mark under test
 * is Portus Lemanis. `/api/spot` itself is stubbed so the assertions are about
 * what the box does with an answer, not about which towns and terrain tiles the
 * machine running the suite happens to hold; the endpoint's own contract has a
 * test of its own below.
 */
const PORTUS_LEMANIS = { lon: 1.0203, lat: 51.0682 }

test.describe('a reference mark’s info box', () => {
  test('states where the mark is and whose record it is, and fetches the rest only when asked', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    let spotRequests = 0

    await page.route('**/api/spot?**', async (route) => {
      spotRequests += 1
      await route.fulfill({
        json: {
          nearestTown: { name: 'Lympne', distanceMetres: 1200 },
          countryCode: 'GB',
          elevationMetres: 23,
          extentSpans: [[47, 407]],
        },
      })
    })

    await page.goto(`/#map=12/${PORTUS_LEMANIS.lat}/${PORTUS_LEMANIS.lon}`)
    await waitForMapReady(page)
    await toggleOverlay(page, 'Ports')
    await waitForTiles(page)

    const canvas = await page.locator('.maplibregl-canvas').boundingBox()
    await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2)

    const popup = page.locator('.maplibregl-popup-content')
    await expect(popup).toContainText('Portus Lemanis')
    await expect(popup).toContainText('51.0682, 1.0203')
    await expect(popup).toContainText('Catalogue of Ancient Ports')
    await expect(popup).toContainText('CC BY 4.0')

    // Collapsed: most taps want the mark, not its surroundings, and cost nothing.
    expect(spotRequests).toBe(0)

    await popup.getByText('About this spot').click()
    await expect(popup).toContainText('Near Lympne (1.2 km), United Kingdom')
    await expect(popup).toContainText('Elevation about 20 m')
    await expect(popup).toContainText('recorded extent: AD 47 – AD 407')
    await expect(popup).toContainText('GeoNames')
    expect(spotRequests).toBe(1)

    // The title must stay clear of the search field and buttons floating over the map.
    const clearance = await page.evaluate(() => {
      const box = document.querySelector('.maplibregl-popup-content')!.getBoundingClientRect()
      const map = document.querySelector('.maplibregl-canvas')!.getBoundingClientRect()
      return box.top - map.top
    })
    expect(clearance).toBeGreaterThanOrEqual(70)

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })
})

test.describe('GET /api/spot', () => {
  test('answers from the coordinate alone, in the shape the info box reads', async ({
    request,
  }) => {
    const response = await request.get('/api/spot?lon=8.8985&lat=47.5565')
    expect(response.status()).toBe(200)

    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual([
      'countryCode',
      'elevationMetres',
      'extentSpans',
      'nearestTown',
    ])
    // Private: the query string is the cache key's whole content, and the CDN ignores it.
    expect(response.headers()['cache-control']).toMatch(/private|no-store/)
  })

  test('refuses a coordinate that is not one', async ({ request }) => {
    expect((await request.get('/api/spot?lon=abc&lat=1')).status()).toBe(400)
    expect((await request.get('/api/spot?lon=200&lat=1')).status()).toBe(400)
  })
})
