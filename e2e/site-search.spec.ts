import { expect, test } from './helpers/fixtures'
import { fetchAsBrowser } from './helpers/api'
import { openOverlays, waitForMapReady } from './helpers/map'

/**
 * Needs published fortifications imported (`pnpm import:convert`), which any
 * seeded database has. A site is drawn by the "Show sites" layer, off until a
 * reader switches it on — picking one from the search field has to do that
 * itself or the camera arrives at an open record with nothing marking it.
 */
test.describe('site search', () => {
  test('switches the sites layer on when a fortification result is picked', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)

    const response = await fetchAsBrowser<{ title: string; category: string }[]>(
      page,
      '/api/sites/search?q=castellum&limit=20',
    )
    expect(response.status).toBe(200)
    const fortification = response.body.find((site) => site.category === 'fortification')
    expect(fortification, 'no published fortification matches "castellum"').toBeTruthy()

    await openOverlays(page)
    await expect(page.getByRole('menuitemcheckbox', { name: 'Sites' })).not.toBeChecked()
    await page.keyboard.press('Escape')

    await page.getByRole('searchbox').fill(fortification!.title)
    const result = page
      .getByRole('button', { name: fortification!.title })
      .filter({ hasText: 'Fortification' })
      .first()
    await expect(result).toBeVisible({ timeout: 15_000 })

    await result.click()

    await openOverlays(page)
    await expect(page.getByRole('menuitemcheckbox', { name: 'Sites' })).toBeChecked()
  })
})
