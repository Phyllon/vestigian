import { expect, test } from './helpers/fixtures'
import { openOverlays, waitForMapReady } from './helpers/map'

/**
 * Needs the Atlas of Hillforts imported (`pnpm import:hillforts-atlas`), like
 * `reference-overlays.spec.ts`. "Dun Mor, Angus (Acharn)" is atlas number 3067.
 */
test.describe('reference-layer search', () => {
  test('finds a hillfort by a name typed without its punctuation and switches its layer on', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForMapReady(page)

    await page.getByRole('searchbox').fill('dun mor angus')
    const result = page.getByRole('button', { name: /Dun Mor, Angus \(Acharn\)/ })
    await expect(result).toBeVisible({ timeout: 15_000 })
    await expect(result).toContainText('Hillfort')

    await result.click()

    await openOverlays(page)
    await expect(page.getByRole('menuitemcheckbox', { name: 'Hillforts' })).toBeChecked()
  })

  test('has exactly one control for clearing the typed term', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)

    await page.getByRole('searchbox').fill('dun')
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(1)
    await expect(page.locator('#map-search')).toHaveAttribute('type', 'text')
  })
})
