import { expect, test } from './helpers/fixtures'
import { openMap, openOverlays } from './helpers/map'

/**
 * The Tabula Peutingeriana network overlay (places and roads reconstructed
 * to real coordinates, drawn over any basemap) — not the manuscript viewer
 * covered by `tabula-peutingeriana.spec.ts`. The dataset states no licence of
 * its own; its compiler, René Voorburg, confirmed reuse, so the layer is on by
 * default and `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED=false` withdraws it.
 */
test.describe('the Tabula Peutingeriana network overlay', () => {
  test('is offered in the overlay menu next to the frontier switch', async ({ page }) => {
    await openMap(page)
    await openOverlays(page)

    await expect(page.getByRole('menu', { name: 'Overlays' })).toHaveCount(1)
    await expect(page.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toHaveCount(1)
    await expect(
      page.getByRole('menuitemcheckbox', { name: /Tabula Peutingeriana network/ }),
    ).toHaveCount(1)
  })

  test('the network endpoint serves places and roads as GeoJSON', async ({ page }) => {
    const response = await page.request.get('/api/tabula-peutingeriana/network.geojson')
    expect(response.status()).toBe(200)

    const body = (await response.json()) as { type: string; features: unknown[] }
    expect(body.type).toBe('FeatureCollection')
    expect(body.features.length).toBeGreaterThan(0)
  })
})
