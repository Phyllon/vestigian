import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, waitForTiles } from './helpers/map'

/**
 * The antiquity views are the only raster basemaps in the application and the
 * only ones fetched from an origin outside the app. Both of those are things
 * the production build can refuse and the development server cannot: a tile
 * host missing from the CSP allowlist fails silently, exactly as the missing
 * nonce token once did.
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
    // not before it grew to five entries in two groups.
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
    await page.waitForTimeout(3_000)

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
    await page.waitForTimeout(2_000)

    expect(tiles.length, 'no antiquity tile was requested at all').toBeGreaterThan(0)
    expect(tiles.some((status) => status === 200)).toBe(true)
    expect(problems.cspViolations, 'the antiquity tile origin is not allowlisted').toEqual([])
  })

  test('keeps the site overlay across a style swap', async ({ page }) => {
    const tileRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/tiles/')) tileRequests.push(request.url())
    })

    await openMap(page)
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
    await chooseBasemap(page, 'Vestigia')
    await waitForTiles(page)
    expect(tileRequests.length).toBeGreaterThan(afterAntiquity)
  })
})
