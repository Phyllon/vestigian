import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, waitForMapReady } from './helpers/map'

/**
 * The Tabula Peutingeriana is a standalone IIIF deep-zoom viewer, not a
 * basemap layer — the manuscript is schematic, not georeferenced, so it is
 * never draped under real coordinates. This suite covers the two failure
 * classes a raster basemap test in this project always covers (CSP refusal
 * of the third-party origin, the tile request never firing at all) plus the
 * entry point from the basemap switcher.
 */
test.describe('the Tabula Peutingeriana viewer', () => {
  test('is reachable from the basemap switcher, not offered as a sheet', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: /^Basemap:/ }).click()

    const antiquity = page.getByRole('group', { name: 'Antiquity' })
    // Still exactly two radios in the group — the entry point is a link, not
    // a third sheet to select.
    await expect(antiquity.getByRole('menuitemradio')).toHaveCount(2)

    const link = antiquity.getByRole('menuitem', { name: /Tabula Peutingeriana/ })
    await expect(link).toBeVisible()
    await link.click()

    await expect(page).toHaveURL(/\/tabula-peutingeriana$/)
  })

  test('draws the manuscript from its IIIF source without a CSP refusal', async ({ page }) => {
    const problems = watchForProblems(page)
    const tiles: number[] = []

    page.on('response', (response) => {
      if (response.url().includes('iiif.omnesviae.org')) tiles.push(response.status())
    })

    await page.goto('/tabula-peutingeriana')
    await page.waitForTimeout(3_000)

    expect(tiles.length, 'no IIIF request was made at all').toBeGreaterThan(0)
    expect(tiles.some((status) => status === 200)).toBe(true)
    expect(problems.cspViolations, 'the IIIF origin is not allowlisted').toEqual([])
  })

  test('leaves the map itself untouched', async ({ page }) => {
    // The point of a standalone page rather than a fifth basemap: visiting it
    // and returning must not have left any trace on the map's own state.
    await openMap(page)
    await page.goto('/tabula-peutingeriana')
    await page.goBack()
    await waitForMapReady(page)
  })
})
