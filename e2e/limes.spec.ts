import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, waitForTiles } from './helpers/map'

/**
 * The frontier is a switch on the Barrington sheet rather than a sixth view,
 * which makes two things worth asserting that a unit test cannot: that the
 * switch is not reachable from a sheet it would mislead on, and that turning it
 * on actually reaches this application's own tile endpoint from inside
 * MapLibre's worker — where a root-relative URL throws and the source silently
 * loads nothing while the rest of the style renders.
 */
const chooseBasemap = async (page: Parameters<typeof openMap>[0], label: string): Promise<void> => {
  await page.getByRole('button', { name: /^Basemap:/ }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}

const toggleLimes = async (page: Parameters<typeof openMap>[0]): Promise<void> => {
  await page.getByRole('button', { name: /^Basemap:/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /Follow the limes/ }).click()
  await page.keyboard.press('Escape')
}

test.describe('following the limes', () => {
  test('is offered only on the sheet it belongs to', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: /^Basemap:/ }).click()

    // The default view is 'vestigia', a modern road map. A frontier drawn
    // against present-day motorways would assert a continuity that is not there.
    await expect(page.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toBeHidden()

    await page.getByRole('menuitemradio', { name: 'Antiquity (Barrington)' }).click()
    await page.getByRole('button', { name: /^Basemap:/ }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toBeVisible()
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
