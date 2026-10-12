import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, showSites, waitForMapReady, waitForTiles } from './helpers/map'

/**
 * The map is the application. If this file fails, nothing else matters — and
 * these are the assertions no unit test can make, because every bug they cover
 * was a browser-side failure with a healthy server behind it.
 */
test.describe('the map', () => {
  test('boots, mounts Vue and clears its placeholder', async ({ page }) => {
    const problems = watchForProblems(page)

    await page.goto('/')
    await waitForMapReady(page)

    // The regression that matters: a CSP without a nonce token refused the
    // inline script carrying the runtime config, Vue never mounted, and the
    // server-rendered placeholder stayed up forever behind a 200.
    expect(problems.cspViolations, 'the page reported CSP violations').toEqual([])
    expect(problems.pageErrors, 'the page threw during boot').toEqual([])
  })

  test('the header sets the atlas name with its own V, still one word to a reader', async ({
    page,
  }) => {
    await openMap(page)

    // The V is drawn (inline SVG) and its letters are hidden from assistive
    // technology; a visually hidden span carries the whole name, so the link is
    // still found by it.
    const home = page.getByRole('banner').getByRole('link', { name: 'Vestigian' })
    await expect(home).toBeVisible()

    const mark = home.locator('svg')
    await expect(mark).toBeVisible()
    await expect(mark, 'the deep wine on the light header').toHaveCSS('fill', 'rgb(122, 31, 47)')
  })

  test('serves vector tiles as binary, not as serialised JSON', async ({ page }) => {
    const tileResponses: { status: number; type: string; bytes: number }[] = []

    page.on('response', async (response) => {
      if (!response.url().includes('/api/tiles/')) return
      const type = response.headers()['content-type'] ?? ''
      const length = Number(response.headers()['content-length'] ?? 0)
      tileResponses.push({ status: response.status(), type, bytes: length })
    })

    // Sites are off at first load (see `map.spec.ts`'s companion test in
    // `basemap.spec.ts`), so nothing here fires until the switch is used.
    await openMap(page)
    await showSites(page)
    await waitForTiles(page)

    expect(tileResponses.length, 'the map requested no tiles at all').toBeGreaterThan(0)

    // Nitro's route cache once serialised tile buffers into
    // `{"type":"Buffer","data":[…]}` — eight times the size, still a 200, and
    // MapLibre silently rendered nothing.
    for (const tile of tileResponses) {
      expect([200, 204]).toContain(tile.status)
      if (tile.status === 200) {
        expect(tile.type).toContain('application/vnd.mapbox-vector-tile')
      }
    }
  })

  test('answers tiles from cache on a second visit', async ({ page }) => {
    await openMap(page)
    await showSites(page)
    await waitForTiles(page)

    const cacheHeaders: string[] = []
    page.on('response', (response) => {
      if (!response.url().includes('/api/tiles/')) return
      const header = response.headers()['x-tile-cache']
      if (header) cacheHeaders.push(header)
    })

    // The switch is not persisted (`isShowingSites`, `useBasemapStyle`) — a
    // reload starts off again, same as any other fresh visit — so it has to
    // be turned on a second time for the reload to request anything at all.
    await page.reload()
    await waitForMapReady(page)
    await showSites(page)
    await waitForTiles(page)

    // Warmed by the first visit. A cache that never hits means the whole tile
    // design — one Valkey lookup instead of a PostGIS aggregate — is not
    // working, which is invisible in any single response.
    expect(cacheHeaders.length, 'no tile carried an x-tile-cache header').toBeGreaterThan(0)
    expect(cacheHeaders, 'no tile was served from cache on reload').toContain('hit')
  })

  test('writes the camera into the hash once the map is moved', async ({ page }) => {
    await openMap(page)

    // The hash is written on `moveend`, not on load — a map that has never been
    // touched deliberately leaves the URL clean. So move it.
    const canvas = page.getByRole('application', { name: 'Map of archaeological sites' })
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 - 180, box!.y + box!.height / 2 - 120, {
      steps: 12,
    })
    await page.mouse.up()

    await page.waitForFunction(() => window.location.hash.startsWith('#map='), null, {
      timeout: 10_000,
    })

    // `#map=<zoom×2dp>/<lat×5dp>/<lon×5dp>`, which `router.options.ts` must not
    // treat as a scroll selector — an invalid-selector warning here was a real
    // bug once.
    expect(new URL(page.url()).hash).toMatch(/^#map=\d+\.\d{2}\/-?\d+\.\d{5}\/-?\d+\.\d{5}$/)
  })
})

test.describe('the header menu on a short phone', () => {
  // 375×420: shorter than the menu's twelve entries, which is every landscape phone.
  test.use({ viewport: { width: 375, height: 420 } })

  test('stays inside the screen and scrolls to its last entry', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)

    await page.getByRole('button', { name: 'Menu' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    // Nuxt UI puts no height on the menu itself, so it used to be as tall as its
    // list and run off the bottom of the screen with nothing to scroll.
    const box = (await menu.boundingBox())!
    expect(box.y + box.height, 'the menu ends inside the viewport').toBeLessThanOrEqual(420)

    const last = menu.getByRole('menuitem').last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
  })
})
