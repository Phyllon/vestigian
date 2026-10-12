import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import {
  openMap,
  openMapSettings,
  openOverlays,
  openPeriods,
  showSites,
  toggleOverlay,
  waitForMapReady,
  waitForTiles,
} from './helpers/map'

/**
 * The antiquity views and the satellite view are the only raster basemaps in
 * the application, and the only ones fetched from an origin outside the app —
 * `Vestigian` is the only vector view left after `modern` was dropped as too
 * similar a recolouring of the same source to earn a second entry. All three
 * raster views are things the production build can refuse and the
 * development server cannot: a tile host missing from the CSP allowlist
 * fails silently, exactly as the missing nonce token once did.
 */
const chooseBasemap = async (page: Parameters<typeof openMap>[0], label: string): Promise<void> => {
  await page.getByRole('button', { name: /^Basemap:/ }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}

test.describe('the basemap switcher', () => {
  test('offers the antiquity sheets in their own group', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: /^Basemap:/ }).click()

    const antiquity = page.getByRole('group', { name: 'Antiquity' })
    await expect(antiquity.getByRole('menuitemradio')).toHaveCount(2)
    await expect(page.getByRole('group', { name: 'Today' }).getByRole('menuitemradio')).toHaveCount(
      3,
    )

    // The panel has to be dismissable without choosing something, which it was
    // not before it grew to four entries in two groups.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Basemap' })).toBeHidden()
  })

  test('draws the antiquity atlas from this application, not a third party', async ({ page }) => {
    const problems = watchForProblems(page)
    const atlas: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity/')) atlas.push(response.status())
    })

    await openMap(page)
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await expect.poll(() => atlas.length, { timeout: 15_000 }).toBeGreaterThan(0)

    // MapLibre builds tile requests inside a worker, where a root-relative URL
    // has no base and `new Request` throws — the source then loads nothing
    // while the rest of the style renders, which is exactly what this looked
    // like when it was broken.
    expect(atlas.length, 'no atlas tile was requested at all').toBeGreaterThan(0)
    expect(atlas.some((status) => status === 200)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('serves atlas tiles as binary, cached apart from the site pyramid', async ({ page }) => {
    await openMap(page)

    const response = await page.request.get('/api/tiles/antiquity/6/33/22.mvt')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('vector-tile')

    // Its own generation. Sharing the site data version would throw away the
    // whole coastline pyramid every time a moderator approved a photograph.
    expect(response.headers()['x-atlas-version']).toBeDefined()
    expect((await response.body()).length).toBeGreaterThan(1_000)
  })

  test('draws the DARE sheet without a CSP refusal', async ({ page }) => {
    const problems = watchForProblems(page)
    const tiles: number[] = []

    page.on('response', (response) => {
      if (/\/(imperium|tiles|basemap\/dare)\/\d+\/\d+\/\d+\.png/.test(response.url())) {
        tiles.push(response.status())
      }
    })

    await openMap(page)
    await chooseBasemap(page, 'Antiquity (DARE)')
    await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(tiles.length, 'no antiquity tile was requested at all').toBeGreaterThan(0)
    expect(tiles.some((status) => status === 200)).toBe(true)
    expect(problems.cspViolations, 'the antiquity tile origin is not allowlisted').toEqual([])
  })

  test('draws the satellite sheet without a CSP refusal', async ({ page }) => {
    // Same failure class as the DARE test above: EOX's tile host missing from
    // the CSP allowlist would fail silently, with a blank sheet and nothing
    // in the page's own console to explain why.
    const problems = watchForProblems(page)
    const tiles: number[] = []

    page.on('response', (response) => {
      if (/tiles\.maps\.eox\.at|basemap\/satellite\/\d+\/\d+\/\d+\.jpg/.test(response.url())) {
        tiles.push(response.status())
      }
    })

    await openMap(page)
    await chooseBasemap(page, 'Satellite')
    await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(tiles.length, 'no satellite tile was requested at all').toBeGreaterThan(0)
    expect(tiles.some((status) => status === 200)).toBe(true)
    expect(problems.cspViolations, 'the satellite tile origin is not allowlisted').toEqual([])
  })

  test('the period scrubber draws the empire over any basemap, requesting nothing until moved', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const periodTiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity-empire/')) {
        periodTiles.push(response.status())
      }
    })

    // Default basemap is 'Vestigian', not an antiquity sheet — proving the
    // scrubber is no longer gated to the Barrington sheet the way it used to
    // be (see `PeriodSwitcher.vue`'s own docstring).
    await openMap(page)
    await waitForTiles(page)
    expect(
      periodTiles.length,
      'a reader who never touches the scrubber should request nothing',
    ).toBe(0)

    await openPeriods(page)
    const slider = page.getByRole('slider', { name: 'The Roman Empire, over time' })

    /**
     * Wait for the stops to arrive before touching the slider.
     *
     * The scrubber's steps are fetched when the panel opens, not bundled, so
     * for a moment the slider is mounted and focusable with `aria-valuemax="0"`
     * — a range of exactly one value. An arrow key in that window is clamped to
     * the value it already has, the year never changes, and no empire tile is
     * ever requested, so the poll below times out. Nothing is wrong with the
     * application; the test was simply racing its own fetch, and lost
     * intermittently (on maplibre 5 and 6 alike).
     *
     * `press` rather than `focus` + `page.keyboard`, so the key goes to this
     * element under Playwright's own actionability checks.
     */
    await expect(slider).toHaveAttribute('aria-valuemax', /^[1-9]\d*$/)
    await slider.press('ArrowRight')
    await expect.poll(() => periodTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(periodTiles.some((status) => status === 200 || status === 204)).toBe(true)

    // The first step is the founding of the Republic, and the scrubber's
    // steps are fetched rather than hardcoded — so this also proves
    // `/api/atlas/empire-periods` answered before the slider became usable.
    await expect(page.getByText('509 BCE')).toBeVisible()
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('battles draw over any basemap, requesting nothing until switched on', async ({ page }) => {
    const problems = watchForProblems(page)
    const battleTiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity-battles/')) {
        battleTiles.push(response.status())
      }
    })

    // Default basemap is 'Vestigian', not an antiquity sheet — proving the
    // overlay is not gated to one sheet, the same as every overlay in this
    // file including the period scrubber above.
    await openMap(page)
    await waitForTiles(page)
    expect(battleTiles.length, 'a reader who never touches the switch should request nothing').toBe(
      0,
    )

    await openOverlays(page)
    await page.getByRole('menuitemcheckbox', { name: 'Battles' }).click()
    await expect.poll(() => battleTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(battleTiles.some((status) => status === 200 || status === 204)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('ports draw over any basemap, requesting nothing until switched on', async ({ page }) => {
    const problems = watchForProblems(page)
    const portTiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity-ports/')) portTiles.push(response.status())
    })

    await openMap(page)
    await waitForTiles(page)
    expect(portTiles.length, 'a reader who never touches the switch should request nothing').toBe(0)

    await openOverlays(page)
    await page.getByRole('menuitemcheckbox', { name: 'Ports' }).click()
    await expect.poll(() => portTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(portTiles.some((status) => status === 200 || status === 204)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('ancient routes draw over any basemap, requesting nothing until switched on', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const routeTiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity-routes/')) {
        routeTiles.push(response.status())
      }
    })

    await openMap(page)
    await waitForTiles(page)
    expect(routeTiles.length, 'a reader who never touches the switch should request nothing').toBe(
      0,
    )

    await openOverlays(page)
    await page.getByRole('menuitemcheckbox', { name: 'Ancient routes' }).click()
    await expect.poll(() => routeTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(routeTiles.some((status) => status === 200 || status === 204)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('minor antiquities draw over any basemap, requesting nothing until switched on', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const featureTiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity-features/')) {
        featureTiles.push(response.status())
      }
    })

    await openMap(page)
    await waitForTiles(page)
    expect(
      featureTiles.length,
      'a reader who never touches the switch should request nothing',
    ).toBe(0)

    await openOverlays(page)
    await page.getByRole('menuitemcheckbox', { name: 'Minor antiquities' }).click()
    await expect.poll(() => featureTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(featureTiles.some((status) => status === 200 || status === 204)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('coin hoards draw over any basemap, requesting nothing until switched on', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const coinHoardTiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/antiquity-coin-hoards/')) {
        coinHoardTiles.push(response.status())
      }
    })

    await openMap(page)
    await waitForTiles(page)
    expect(
      coinHoardTiles.length,
      'a reader who never touches the switch should request nothing',
    ).toBe(0)

    await openOverlays(page)
    await page.getByRole('menuitemcheckbox', { name: 'Coin hoards' }).click()
    await expect.poll(() => coinHoardTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(coinHoardTiles.some((status) => status === 200 || status === 204)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('sites draw over any basemap, requesting nothing until switched on', async ({ page }) => {
    const problems = watchForProblems(page)
    const siteTiles: number[] = []

    page.on('response', (response) => {
      // `/api/tiles/{z}/{x}/{y}.mvt` — the plain form every other tile route
      // (antiquity, limes, battles, periods) nests a name under, so this is
      // matched by its shape rather than mistaken for one of those instead.
      if (/\/api\/tiles\/\d+\/\d+\/\d+\.mvt/.test(response.url())) siteTiles.push(response.status())
    })

    await openMap(page)
    expect(siteTiles.length, 'a reader who never touches the switch should request nothing').toBe(0)

    await showSites(page)
    await expect.poll(() => siteTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

    expect(siteTiles.some((status) => status === 200 || status === 204)).toBe(true)
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('the site density switch appears with the sites and requests individual markers', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const everySiteTiles: string[] = []

    page.on('request', (request) => {
      if (/\/api\/tiles\/every\/\d+\/\d+\/\d+\.mvt/.test(request.url())) {
        everySiteTiles.push(request.url())
      }
    })

    await openMap(page)
    await openMapSettings(page)
    const toggle = page.getByRole('switch', { name: 'Every site as its own marker' })
    await expect(toggle).toBeHidden()
    await page.keyboard.press('Escape')

    await showSites(page)
    await openMapSettings(page)
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(everySiteTiles.length, 'clusters are the default').toBe(0)

    await toggle.click()
    await expect.poll(() => everySiteTiles.length, { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('the settings gear says a new option has appeared, until the reader has looked', async ({
    page,
  }) => {
    await openMap(page)
    const gear = page.getByRole('button', { name: 'Map settings' })
    await expect(gear, 'nothing is new while the sites are off').toHaveAccessibleName(
      'Map settings',
    )

    await showSites(page)
    await expect(
      gear,
      'the row that sites bring is announced on the closed gear',
    ).toHaveAccessibleName('Map settings, new option available')

    await gear.click()
    const toggle = page.getByRole('switch', { name: /Every site as its own marker/ })
    await expect(toggle).toBeVisible()
    await expect(toggle, 'the row itself says it is the new one').toHaveAccessibleName(
      /marker\s+New$/,
    )
    await page.keyboard.press('Escape')
    await expect(gear, 'closing the settings is what counts as having looked').toHaveAccessibleName(
      'Map settings',
    )

    // Remembered: the sites are off again after a reload, and switching them on
    // does not announce a row the reader has already met.
    await page.reload()
    await waitForMapReady(page)
    await showSites(page)
    await expect(gear).toHaveAccessibleName('Map settings')
  })

  test('keeps the site overlay across a style swap', async ({ page }) => {
    const tileRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/tiles/')) tileRequests.push(request.url())
    })

    await openMap(page)
    await showSites(page)
    await waitForTiles(page)
    const beforeSwap = tileRequests.length
    expect(beforeSwap, 'the overlay never loaded in the first place').toBeGreaterThan(0)

    // setStyle discards every source and layer the app added; only the
    // styledata hook in keepOverlayThroughStyleChanges puts them back. Without
    // it the map silently empties of its own content on the first switch, and
    // the observable proof it was re-attached is that the overlay source asks
    // the tile endpoint for its viewport again.
    await chooseBasemap(page, 'Antiquity (DARE)')
    await waitForTiles(page)
    expect(tileRequests.length, 'the overlay was not re-attached').toBeGreaterThan(beforeSwap)

    const afterAntiquity = tileRequests.length
    await chooseBasemap(page, 'Vestigian')
    await waitForTiles(page)
    expect(tileRequests.length).toBeGreaterThan(afterAntiquity)
  })

  /**
   * Attribution is the licence condition itself for most of these sources —
   * de Graauw's ports are CC BY 4.0, ORBIS CC BY 3.0, CHRR CC BY-NC-SA, AWMC
   * ODbL — and every one of them shipped without any. The gap was invisible
   * until the vici site overlay went off by default, taking with it the one
   * credit line the others were leaning on.
   */
  test('credits an overlay source while that overlay is switched on', async ({ page }) => {
    await openMap(page)

    const attribution = page.locator('.maplibregl-ctrl-attrib')
    await expect(attribution).toContainText('OpenStreetMap')
    await expect(attribution).not.toContainText('de Graauw')

    await toggleOverlay(page, 'Ports')
    await expect(attribution).toContainText('de Graauw')
    await expect(attribution).toContainText('CC BY 4.0')

    // And leaves with it: a credit for a layer nobody is looking at would be
    // as wrong as a missing one.
    await toggleOverlay(page, 'Ports')
    await expect(attribution).not.toContainText('de Graauw')
  })
})
