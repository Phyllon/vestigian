import { expect, test } from './helpers/fixtures'
import { IMGPROXY_OVER_HTTP, watchForProblems } from './helpers/console'
import { openMap, waitForMapReady } from './helpers/map'

/**
 * `/columns` explores two monuments' reliefs, each through the mechanism its
 * own source actually calls for — Trajan's Column mirrored into this
 * project's own storage, the Column of Marcus Aurelius served live via
 * Heidelberg University Library's IIIF API. This suite covers the same
 * failure classes `e2e/tabula-peutingeriana.spec.ts` covers for its own IIIF
 * source (CSP refusal, the request never firing), plus the mirrored gallery
 * actually rendering images through this project's own imgproxy pipeline.
 */
test.describe('the column reliefs page', () => {
  test('is reachable from the app menu', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Column reliefs' }).click()

    await expect(page).toHaveURL('/columns')
  })

  test("Trajan's Column tab renders mirrored plates through imgproxy", async ({ page }) => {
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })

    await page.goto('/columns')
    await expect(page.getByRole('heading', { name: 'Column Reliefs' })).toBeVisible()

    const grid = page.getByRole('list', { name: "Trajan's Column relief plates" })
    await expect(grid.getByRole('listitem').first()).toBeVisible({ timeout: 15_000 })

    const firstImage = grid.getByRole('listitem').first().locator('img')
    await expect(firstImage).toHaveJSProperty('complete', true)
    expect(problems.cspViolations).toEqual([])
  })

  test("the Column of Marcus Aurelius tab renders real tiles through this project's own proxy", async ({
    page,
  }) => {
    // The Trajan tab (the page's default) loads its mirrored plates through
    // imgproxy as soon as the page mounts, alongside this test's own
    // navigation — see IMGPROXY_OVER_HTTP's own docstring for why that's a
    // dev-against-production-build artifact, not a real CSP gap.
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })
    const proxyResponses: number[] = []
    let directHeidelbergRequests = 0

    page.on('response', (response) => {
      if (response.url().includes('/api/columns/marcus-aurelius/')) {
        proxyResponses.push(response.status())
      }
      // The whole point of the proxy: the browser must never talk to
      // Heidelberg directly. A real run of the very first version of this
      // component did exactly that and failed silently at the network
      // layer ("Failed to fetch") — a `response` event for that host here
      // would be the same class of regression happening again.
      if (response.url().includes('digi.ub.uni-heidelberg.de')) directHeidelbergRequests += 1
    })

    await page.goto('/columns')
    await page.getByRole('tab', { name: 'Column of Marcus Aurelius' }).click()

    // A prior version of this test only checked that *some* network response
    // arrived from Heidelberg, which stayed green even while OpenSeadragon
    // itself failed to open the manifest — the network layer succeeding is
    // not the same claim as the viewer actually working. Asserting on the
    // canvas OpenSeadragon draws into is the real claim.
    await expect(page.locator('.openseadragon-canvas canvas').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('This volume could not be loaded')).toBeHidden()

    expect(proxyResponses.length, 'no tile was requested through the proxy at all').toBeGreaterThan(
      0,
    )
    expect(proxyResponses.some((status) => status === 200)).toBe(true)
    expect(directHeidelbergRequests, 'the browser must never talk to Heidelberg directly').toBe(0)
    expect(problems.cspViolations).toEqual([])
  })

  test('leaves the map itself untouched', async ({ page }) => {
    await openMap(page)
    await page.goto('/columns')
    await page.goBack()
    await waitForMapReady(page)

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: /^Basemap:/ })).toBeVisible()
  })

  test('opening a Trajan plate gives a real zoom viewer, not a scrolling frame', async ({
    page,
  }) => {
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })

    await page.goto('/columns')
    const grid = page.getByRole('list', { name: "Trajan's Column relief plates" })
    await expect(grid.getByRole('listitem').first()).toBeVisible({ timeout: 15_000 })

    // The third thumbnail, so the pager has to show 3 rather than passing by
    // starting at the beginning of the sequence.
    await grid.getByRole('listitem').nth(2).getByRole('button').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.openseadragon-canvas canvas').first()).toBeVisible({
      timeout: 20_000,
    })

    const plateNumber = dialog.getByRole('spinbutton', { name: 'Plate number' })
    await expect(plateNumber).toHaveValue('3')

    // Typed directly, not clicked to. The old carousel had no way to do this
    // at all — reaching plate 90 meant 89 clicks.
    await plateNumber.fill('7')
    await plateNumber.press('Enter')
    await expect(plateNumber).toHaveValue('7')

    // Refused rather than clamped: silently turning 500 into the last plate
    // looks like the field ignored what was typed.
    await plateNumber.fill('500')
    await plateNumber.press('Enter')
    await expect(plateNumber).toHaveValue('7')

    /**
     * Full page is deliberately absent here. `setFullPage(true)` hides every
     * child of `document.body` and moves the viewer element out to the body,
     * and only `setFullPage(false)` restores them — so unmounting this viewer
     * while full-page (closing the modal, Escape, a route change) leaves the
     * whole application hidden with nothing able to bring it back. Reported
     * exactly that way: "the whole page is gone, even after pressing Esc".
     */
    await expect(dialog.locator('.openseadragon-container [title="Toggle full page"]')).toHaveCount(
      0,
    )

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('remembers the Marcus Aurelius plate a reader left off at', async ({ page }) => {
    await page.goto('/columns')
    await page.getByRole('tab', { name: 'Column of Marcus Aurelius' }).click()
    await expect(page.locator('.openseadragon-canvas canvas').first()).toBeVisible({
      timeout: 20_000,
    })

    const plateNumber = page.getByRole('spinbutton', { name: 'Plate number' })
    await plateNumber.fill('9')
    await plateNumber.press('Enter')
    await expect(plateNumber).toHaveValue('9')

    // Away and back by client-side navigation, which is the case that used to
    // drop the position — the route carries no page, so nothing but the
    // stored one can bring it back.
    await page.getByRole('link', { name: 'Vestigian' }).first().click()
    await waitForMapReady(page)
    await page.goBack()

    await page.getByRole('tab', { name: 'Column of Marcus Aurelius' }).click()
    await expect(page.getByRole('spinbutton', { name: 'Plate number' })).toHaveValue('9', {
      timeout: 20_000,
    })
  })
})
