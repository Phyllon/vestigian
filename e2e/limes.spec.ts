import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, openOverlays, showSites, toggleOverlay, waitForTiles } from './helpers/map'

/**
 * The frontier is an overlay drawn above whichever basemap is showing, not a
 * reading of the Barrington sheet specifically any more (see `isFollowingLimes`
 * in `useBasemapStyle` and `useLimesOverlay`) — which makes two things worth
 * asserting that a unit test cannot: that the switch actually works on a sheet
 * other than the one it used to be confined to, and that turning it on reaches
 * this application's own tile endpoint from inside MapLibre's worker — where a
 * root-relative URL throws and the source silently loads nothing while the rest
 * of the style renders.
 */
const chooseBasemap = async (page: Parameters<typeof openMap>[0], label: string): Promise<void> => {
  await page.getByRole('button', { name: /^Basemap:/ }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}

const toggleLimes = async (page: Parameters<typeof openMap>[0]): Promise<void> => {
  await toggleOverlay(page, 'Follow the limes')
}

test.describe('following the limes', () => {
  test('is offered on any basemap, from the overlay switcher', async ({ page }) => {
    await openMap(page)
    await openOverlays(page)

    // The default view is 'vestigian', a modern road map — the switch used to
    // be hidden here entirely. It lives in the overlay switcher now, which is
    // not tied to any one basemap at all.
    const overlays = page.getByRole('menu', { name: 'Overlays' })
    await expect(overlays.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toBeVisible()

    await page.keyboard.press('Escape')
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await openOverlays(page)
    await expect(overlays.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toBeVisible()
  })

  test('draws the frontier over a modern basemap, not only the Barrington sheet', async ({
    page,
  }) => {
    const limesTiles: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/limes/')) limesTiles.push(response.status())
    })

    await openMap(page)
    // Deliberately left on the default 'vestigian' view — the whole point of
    // this test is that the switch no longer requires the Barrington sheet.
    await toggleLimes(page)
    await waitForTiles(page)

    expect(limesTiles.length, 'no frontier tiles were requested').toBeGreaterThan(0)
    expect(limesTiles.every((status) => status < 400)).toBe(true)
  })

  test('draws the frontier from this application, and the overlay survives it', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const limesTiles: number[] = []
    const siteTiles: string[] = []

    page.on('response', (response) => {
      const url = response.url()
      if (url.includes('/api/tiles/limes/')) limesTiles.push(response.status())
      else if (/\/api\/tiles\/\d+\//.test(url)) siteTiles.push(url)
    })

    await openMap(page)
    // Sites are off by default (`isShowingSites`, `useBasemapStyle`) —
    // switched on here since this test's whole point is proving the site
    // overlay survives a style swap, not that it loads unasked.
    await showSites(page)
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await waitForTiles(page)

    const beforeSwap = siteTiles.length
    await toggleLimes(page)
    await waitForTiles(page)

    expect(limesTiles.length, 'no frontier tiles were requested').toBeGreaterThan(0)
    expect(limesTiles.every((status) => status < 400)).toBe(true)

    /**
     * Turning the switch on rebuilds the style, and `setStyle` discards every
     * source and layer the app added. Only the `styledata` hook in
     * `keepOverlayThroughStyleChanges` puts them back — the observable proof it
     * ran is that the overlay source asks the tile endpoint for its viewport
     * again.
     */
    expect(siteTiles.length, 'the site overlay was not re-attached').toBeGreaterThan(beforeSwap)

    expect(problems.cspViolations, 'CSP refused something').toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('explains the line colours and the dash in the key', async ({ page }) => {
    // Colour says what a line is (wall, river, no built works) and dash says how
    // far to trust where it is drawn. Neither can be read off the map alone, so
    // the key has to carry both — in the same words the style's own table uses.
    await openMap(page)
    await toggleLimes(page)
    await page.getByRole('button', { name: 'Key' }).click()

    const key = page.locator('#map-legend')
    await expect(key.getByText('Wall, rampart or ditch')).toBeVisible()
    await expect(key.getByText('River frontier, held from the bank')).toBeVisible()
    await expect(key.getByText('Frontier line without built works')).toBeVisible()
    await expect(key.getByText(/^Solid: follows mapped or surveyed remains/)).toBeVisible()
    await expect(key.getByText(/^Dashed: approximate/)).toBeVisible()
  })

  test('tells the map whether each line is traced, in the tile itself', async ({ page }) => {
    // `traced` is what makes a line solid or dashed; a tile without it would draw
    // every line dashed, with nothing logged. A frontier tile over Britain holds
    // the Antonine and Hadrian lines, so the property is checked on real bytes.
    await page.goto('/')
    const response = await page.request.get('/api/tiles/limes/6/31/20.mvt')
    expect(response.status()).toBe(200)
    expect((await response.body()).toString('latin1')).toContain('traced')
  })

  test('serves a binary tile with the atlas generation on it', async ({ page }) => {
    await page.goto('/')
    const response = await page.request.get('/api/tiles/limes/6/32/21.mvt')

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('vector-tile')
    expect(response.headers()['x-atlas-version']).toBeTruthy()
    expect((await response.body()).byteLength).toBeGreaterThan(64)
  })

  test('offers the sectors and walks one of them in order', async ({ page }) => {
    await openMap(page)
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await toggleLimes(page)

    const panel = page.getByRole('complementary', { name: 'The Roman frontier' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: /Hadrian's Wall/ })).toBeVisible()

    await panel.getByRole('button', { name: /Hadrian's Wall/ }).click()
    await expect(panel.getByRole('link', { name: 'Read this stretch' })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('publishes each stretch as a page of its own', async ({ page }) => {
    const problems = watchForProblems(page)

    await page.goto('/limes')
    await expect(page.getByRole('heading', { name: 'The limes', level: 1 })).toBeVisible()
    await page
      .getByRole('link', { name: /Hadrian's Wall/ })
      .first()
      .click()

    await expect(page.getByRole('heading', { name: "Hadrian's Wall", level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Along the line/ })).toBeVisible()

    /**
     * The roll is the point of the page: ordered along the frontier rather than
     * by id. Milecastles were numbered from the eastern end, so a list walked
     * from the west has them counting down — which is a thing only correct
     * ordering can produce.
     */
    const entries = page.locator('ol li')
    expect(await entries.count()).toBeGreaterThan(20)

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })
})
