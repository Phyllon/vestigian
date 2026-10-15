import { expect, test } from './helpers/fixtures'
import { showSites, waitForMapReady, waitForTiles } from './helpers/map'

/**
 * The site-type filter lives in the bottom-right column and exists only while
 * "Sites" is on. Nothing chosen means every site; choosing kinds draws the
 * map from the every-site tiles (a counted cluster cannot say how many of its
 * sites are temples). See `SiteTypeFilter.vue` and `useSiteTypeFilter.ts`.
 */
const ROME_URL = '/#map=11/41.89/12.49'

test.describe('site type filter', () => {
  test('is absent until the sites are shown, then narrows the map to the chosen kinds', async ({
    page,
  }) => {
    await page.goto(ROME_URL)
    await waitForMapReady(page)

    const trigger = page.getByRole('button', { name: /^Filter site types/ })
    await expect(trigger).toHaveCount(0)

    await showSites(page)
    await expect(trigger).toBeVisible()

    const everySiteTiles: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/tiles/every/')) everySiteTiles.push(request.url())
    })

    await trigger.click()
    const temple = page.getByRole('button', { name: 'Temple', exact: true })
    await expect(temple).toHaveAttribute('aria-pressed', 'false')
    await temple.click()
    await expect(temple).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('status').filter({ hasText: 'of 25 kinds shown' })).toBeVisible()

    await page.keyboard.press('Escape')
    await waitForTiles(page)
    expect(everySiteTiles.length).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Filter site types, 1 chosen' })).toBeVisible()
  })

  test('"All" chooses a whole category and "Clear" puts every site back', async ({ page }) => {
    await page.goto(ROME_URL)
    await waitForMapReady(page)
    await showSites(page)

    await page.getByRole('button', { name: /^Filter site types/ }).click()
    await page.getByRole('button', { name: 'Choose all of Fortification' }).click()
    for (const kind of ['Fort', 'Watchtower', 'Camp']) {
      await expect(page.getByRole('button', { name: kind, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }

    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Fort', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: 'Filter site types' })).toBeVisible()
  })
})
