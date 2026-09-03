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
  test('is hidden while the frontier switch stays offered when the feature flag is off', async ({
    page,
  }) => {
    await openMap(page)
    await page.getByRole('button', { name: /^Basemap:/ }).click()

    // The Overlays group itself is not gated on this flag — "Follow the
    // limes" lives there too, and works on every basemap regardless of this
    // licence-driven gate — so only the Tabula Peutingeriana entry inside it
    // is asserted absent.
    await expect(page.getByRole('group', { name: 'Overlays' })).toHaveCount(1)
    await expect(page.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toHaveCount(1)
    await expect(
      page.getByRole('menuitemcheckbox', { name: /Tabula Peutingeriana network/ }),
    ).toHaveCount(0)
  })

  test('the network endpoint 404s when the feature flag is off', async ({ page }) => {
    const response = await page.request.get('/api/tabula-peutingeriana/network.geojson')
    expect(response.status()).toBe(404)
  })
})
