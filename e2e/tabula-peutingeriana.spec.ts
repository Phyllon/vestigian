import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, waitForMapReady } from './helpers/map'

/**
 * The Tabula Peutingeriana is a standalone IIIF deep-zoom viewer, not a
 * basemap layer — the manuscript is schematic, not georeferenced, so it is
 * never draped under real coordinates. This suite covers the two failure
 * classes a raster basemap test in this project always covers (CSP refusal
 * of the third-party origin, the tile request never firing at all) plus the
 * entry point from the app menu's Reference group, alongside Column Reliefs
 * — it moved out of the basemap switcher entirely since it isn't a sheet.
 */
test.describe('the Tabula Peutingeriana viewer', () => {
  test('is reachable from the app menu, not offered as a basemap sheet', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: /^Basemap:/ }).click()

    const antiquity = page.getByRole('group', { name: 'Antiquity' })
    await expect(antiquity.getByRole('menuitemradio')).toHaveCount(2)
    await expect(antiquity.getByRole('menuitem', { name: /Tabula Peutingeriana/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Menu' }).click()
    const link = page.getByRole('menuitem', { name: /Tabula Peutingeriana/ })
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
    await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0)

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

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: /^Basemap:/ })).toBeVisible()
  })
})
