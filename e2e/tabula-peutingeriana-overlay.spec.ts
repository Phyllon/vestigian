import { expect, test } from './helpers/fixtures'
import { openMap } from './helpers/map'

/**
 * The Tabula Peutingeriana network overlay (places and roads reconstructed
 * to real coordinates, drawn over any basemap) — not the manuscript viewer
 * covered by `tabula-peutingeriana.spec.ts`. Unlike every other view this
 * suite covers, this one has no confirmed licence with its source
 * (omnesviae.org), so it is off unless
 * `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED=true` is set — off is therefore
 * the only state this suite can assert against in the ordinary CI/dev run,
 * and that is the point: a fresh clone must show no trace of it.
 */
test.describe('the Tabula Peutingeriana network overlay', () => {
  test('is hidden entirely when the feature flag is off', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: /^Basemap:/ }).click()

    await expect(page.getByRole('group', { name: 'Overlays' })).toHaveCount(0)
    await expect(
      page.getByRole('menuitemcheckbox', { name: /Tabula Peutingeriana network/ }),
    ).toHaveCount(0)
  })

  test('the network endpoint 404s when the feature flag is off', async ({ page }) => {
    const response = await page.request.get('/api/tabula-peutingeriana/network.geojson')
    expect(response.status()).toBe(404)
  })
})
