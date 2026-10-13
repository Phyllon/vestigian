import { expect, test } from './helpers/fixtures'
import { fetchAsBrowser } from './helpers/api'
import { openOverlays, waitForMapReady } from './helpers/map'

/**
 * The features page and the example behind its button.
 *
 * Reads the dev import's tower `turm-3-25` (see `sightlines.spec.ts`, which
 * names the same record), and like that spec needs terrain to be reachable for
 * the calculated view to appear.
 */
test.describe('the features page', () => {
  test('lists the tower feature with what its button will switch on', async ({ page }) => {
    await page.goto('/features')

    await expect(page.getByRole('heading', { level: 1, name: 'Features' })).toBeVisible()

    const entry = page.locator('[data-feature="towerSightlines"]')
    await expect(entry.getByRole('heading', { level: 2 })).toHaveText('What a watchtower could see')
    // The button's effects are said before it is pressed.
    await expect(entry.getByText('Switches on the sites layer')).toBeVisible()
    await expect(entry.getByText(/Opens Turm 3-25/)).toBeVisible()
  })

  test('opens the tower on the map with everything it needs switched on', async ({ page }) => {
    await page.goto('/features')

    // A client-side navigation, not a reload: the switches live in `useState`.
    await page.evaluate(() => {
      ;(window as unknown as { __stillHere: boolean }).__stillHere = true
    })

    await page.getByRole('button', { name: 'Show me on the map' }).click()
    await waitForMapReady(page)

    expect(
      await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere),
    ).toBe(true)

    // The record is open, and the calculated view is on its panel.
    const section = page.getByRole('region', { name: 'What the tower could see' })
    await expect(section).toBeVisible({ timeout: 30_000 })

    // The layer the tower's icon is drawn on was switched on for the reader.
    await openOverlays(page)
    await expect(page.getByRole('menuitemcheckbox', { name: 'Sites' })).toBeChecked()
  })

  test('leaves the map alone when the example record is not there', async ({ page }) => {
    await page.route('**/api/sites/slug/turm-3-25', (route) =>
      route.fulfill({ status: 404, json: { message: 'No approved site with that identifier.' } }),
    )
    await page.goto('/features')

    await page.getByRole('button', { name: 'Show me on the map' }).click()

    await expect(page.getByRole('alert')).toContainText('not in this atlas')
    await expect(page).toHaveURL(/\/features$/)
  })

  test('is reached from the menu', async ({ page }) => {
    await page.goto('/about')
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('menuitem', { name: 'Features' })).toBeVisible()
  })

  test('is listed in the sitemap', async ({ page }) => {
    await page.goto('/')
    const response = await fetchAsBrowser<string>(page, '/sitemap-static.xml')
    expect(response.status).toBe(200)
    expect(String(response.body)).toContain('/features')
  })
})
