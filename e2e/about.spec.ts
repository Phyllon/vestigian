import { expect, test } from './helpers/fixtures'

test.describe('the about page', () => {
  test('states where the service runs and links to the full legal pages', async ({ page }) => {
    await page.goto('/about')

    await expect(
      page.getByRole('heading', { level: 2, name: 'Operated in the EU, under German and EU law' }),
    ).toBeVisible()
    await expect(page.getByText('Bunny.net (Slovenia)')).toBeVisible()
    await expect(page.getByText('Brevo (France)')).toBeVisible()

    // The exception is stated on the page, not left to the privacy policy alone.
    await expect(page.getByText('CrowdSec (France)')).toBeVisible()

    for (const name of ['Privacy policy', 'Legal notice', 'Data & licences']) {
      await expect(page.getByRole('link', { name })).toBeVisible()
    }
  })
})
