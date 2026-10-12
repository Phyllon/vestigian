import type { Locator, Page } from '@playwright/test'
import { expect, test } from './helpers/fixtures'
import { watchForProblems } from './helpers/console'
import { openMap, openOverlays, showSites, toggleOverlay, waitForTiles } from './helpers/map'

/**
 * The frontier is an overlay drawn above whichever basemap is showing, not a
 * reading of the Barrington sheet specifically any more (see `isFollowingLimes`
 * in `useBasemapStyle` and `useLimesOverlay`) — which makes two things worth
 * asserting that a unit test cannot: that the switch actually works on a sheet
 * other than the one it used to be confined to, and that turning it on reaches
 * this application's own tile endpoint from inside MapLibre's worker — where a
 * root-relative URL throws and the source silently loads nothing while the rest
 * of the style renders.
 */
const chooseBasemap = async (page: Parameters<typeof openMap>[0], label: string): Promise<void> => {
  await page.getByRole('button', { name: /^Basemap:/ }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}

const toggleLimes = async (page: Parameters<typeof openMap>[0]): Promise<void> => {
  await toggleOverlay(page, 'Follow the limes')
}

test.describe('following the limes', () => {
  test('is offered on any basemap, from the overlay switcher', async ({ page }) => {
    await openMap(page)
    await openOverlays(page)

    // The default view is the standard OSM sheet, a modern road map — the switch used to
    // be hidden here entirely. It lives in the overlay switcher now, which is
    // not tied to any one basemap at all.
    const overlays = page.getByRole('menu', { name: 'Overlays' })
    await expect(overlays.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toBeVisible()

    await page.keyboard.press('Escape')
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await openOverlays(page)
    await expect(overlays.getByRole('menuitemcheckbox', { name: /Follow the limes/ })).toBeVisible()
  })

  test('draws the frontier over a modern basemap, not only the Barrington sheet', async ({
    page,
  }) => {
    const limesTiles: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/api/tiles/limes/')) limesTiles.push(response.status())
    })

    await openMap(page)
    // Deliberately left on the default modern view — the whole point of
    // this test is that the switch no longer requires the Barrington sheet.
    await toggleLimes(page)
    await waitForTiles(page)

    expect(limesTiles.length, 'no frontier tiles were requested').toBeGreaterThan(0)
    expect(limesTiles.every((status) => status < 400)).toBe(true)
  })

  test('draws the frontier from this application, and the overlay survives it', async ({
    page,
  }) => {
    const problems = watchForProblems(page)
    const limesTiles: number[] = []
    const siteTiles: string[] = []

    page.on('response', (response) => {
      const url = response.url()
      if (url.includes('/api/tiles/limes/')) limesTiles.push(response.status())
      else if (/\/api\/tiles\/\d+\//.test(url)) siteTiles.push(url)
    })

    await openMap(page)
    // Sites are off by default (`isShowingSites`, `useBasemapStyle`) —
    // switched on here since this test's whole point is proving the site
    // overlay survives a style swap, not that it loads unasked.
    await showSites(page)
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await waitForTiles(page)

    const beforeSwap = siteTiles.length
    await toggleLimes(page)
    await waitForTiles(page)

    expect(limesTiles.length, 'no frontier tiles were requested').toBeGreaterThan(0)
    expect(limesTiles.every((status) => status < 400)).toBe(true)

    /**
     * Turning the switch on rebuilds the style, and `setStyle` discards every
     * source and layer the app added. Only the `styledata` hook in
     * `keepOverlayThroughStyleChanges` puts them back — the observable proof it
     * ran is that the overlay source asks the tile endpoint for its viewport
     * again.
     */
    expect(siteTiles.length, 'the site overlay was not re-attached').toBeGreaterThan(beforeSwap)

    expect(problems.cspViolations, 'CSP refused something').toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('explains the line colours and the dash in the key', async ({ page }) => {
    // Colour says what a line is (wall, river, no built works) and dash says how
    // far to trust where it is drawn. Neither can be read off the map alone, so
    // the key has to carry both — in the same words the style's own table uses.
    await openMap(page)
    await toggleLimes(page)
    await page.getByRole('button', { name: 'Key' }).click()

    const key = page.locator('#map-legend')
    await expect(key.getByText('Wall, rampart or ditch')).toBeVisible()
    await expect(key.getByText('River frontier, held from the bank')).toBeVisible()
    await expect(key.getByText('Frontier line without built works')).toBeVisible()
    await expect(key.getByText(/^Solid: follows mapped or surveyed remains/)).toBeVisible()
    await expect(key.getByText(/^Dashed: approximate/)).toBeVisible()
  })

  test('tells the map whether each line is traced, in the tile itself', async ({ page }) => {
    // `traced` is what makes a line solid or dashed; a tile without it would draw
    // every line dashed, with nothing logged. A frontier tile over Britain holds
    // the Antonine and Hadrian lines, so the property is checked on real bytes.
    await page.goto('/')
    const response = await page.request.get('/api/tiles/limes/6/31/20.mvt')
    expect(response.status()).toBe(200)
    expect((await response.body()).toString('latin1')).toContain('traced')
  })

  test('serves a binary tile with the atlas generation on it', async ({ page }) => {
    await page.goto('/')
    const response = await page.request.get('/api/tiles/limes/6/32/21.mvt')

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('vector-tile')
    expect(response.headers()['x-atlas-version']).toBeTruthy()
    expect((await response.body()).byteLength).toBeGreaterThan(64)
  })

  test('offers the sectors and walks one of them in order', async ({ page }) => {
    await openMap(page)
    await chooseBasemap(page, 'Antiquity (Barrington)')
    await toggleLimes(page)

    const panel = page.getByRole('complementary', { name: 'The Roman frontier' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: /Hadrian's Wall/ })).toBeVisible()

    await panel.getByRole('button', { name: /Hadrian's Wall/ }).click()
    await expect(panel.getByRole('link', { name: 'Read this stretch' })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('publishes each stretch as a page of its own', async ({ page }) => {
    const problems = watchForProblems(page)

    await page.goto('/limes')
    await expect(page.getByRole('heading', { name: 'The limes', level: 1 })).toBeVisible()
    await page
      .getByRole('link', { name: /Hadrian's Wall/ })
      .first()
      .click()

    await expect(page.getByRole('heading', { name: "Hadrian's Wall", level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Along the line/ })).toBeVisible()

    /**
     * The roll is the point of the page: ordered along the frontier rather than
     * by id. Milecastles were numbered from the eastern end, so a list walked
     * from the west has them counting down — which is a thing only correct
     * ordering can produce.
     */
    const entries = page.locator('ol li')
    expect(await entries.count()).toBeGreaterThan(20)

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })
})

/**
 * True when the control is what a finger on its centre would actually hit — not
 * something drawn over it. `toBeVisible` cannot say this: a button buried under
 * another is still "visible", which is exactly how the folded frontier sheet's
 * title and fold button went unnoticed under the key and the map credit.
 */
const isUncovered = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && element.contains(hit)
  })

/** MapLibre opens its compact credit on load; it covers the sheet until the first tap or move. */
const closeMapCredit = async (page: Page): Promise<void> => {
  const open = page.locator('.maplibregl-ctrl-attrib.maplibregl-compact-show')
  if ((await open.count()) > 0) {
    await open.locator('.maplibregl-ctrl-attrib-button').click()
    await expect(open).toHaveCount(0)
  }
}

test.describe('the frontier sheet on a phone', () => {
  test.use({ viewport: { width: 375, height: 700 } })

  const openFoldedSheet = async (page: Page) => {
    await openMap(page)
    await toggleLimes(page)
    const panel = page.getByRole('complementary', { name: 'The Roman frontier' })
    await expect(panel).toBeVisible()
    await closeMapCredit(page)
    await panel.getByRole('button', { name: 'Hide the frontier' }).click()
    await expect(page.locator('#limes-body')).toBeHidden()
    return panel
  }

  test('folded, its title and fold button are not under the key or the credit', async ({
    page,
  }) => {
    const panel = await openFoldedSheet(page)

    expect(await isUncovered(panel.getByText('The limes', { exact: true }))).toBe(true)
    expect(await isUncovered(panel.getByRole('button', { name: 'Show the frontier' }))).toBe(true)

    // The corner controls are still where they were, and still reachable.
    expect(await isUncovered(page.getByRole('button', { name: 'Key' }))).toBe(true)
    expect(await isUncovered(page.locator('.maplibregl-ctrl-attrib-button'))).toBe(true)
    // The control column sits above the folded sheet instead of being cut by it.
    expect(await isUncovered(page.getByRole('button', { name: 'Show your position' }))).toBe(true)
  })

  test('the key sits on one line with the map credit', async ({ page }) => {
    await openMap(page)
    await toggleLimes(page)
    await closeMapCredit(page)

    const key = (await page.getByRole('button', { name: 'Key' }).boundingBox())!
    const credit = (await page.locator('.maplibregl-ctrl-attrib-button').boundingBox())!

    expect(Math.abs(key.y + key.height - (credit.y + credit.height))).toBeLessThanOrEqual(1)
  })

  test('the fold button eases the sheet rather than jumping it', async ({ page }) => {
    const panel = await openFoldedSheet(page)

    // Sampled on every frame, started in the same breath as the click: a jump
    // shows two heights, an ease shows the whole way between them.
    const sampling = page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const aside = document.querySelector('aside[aria-label="The Roman frontier"]')!
          const heights: number[] = []
          const start = performance.now()
          const tick = (): void => {
            heights.push(Math.round(aside.getBoundingClientRect().height))
            if (performance.now() - start < 600) requestAnimationFrame(tick)
            else resolve(heights)
          }
          requestAnimationFrame(tick)
        }),
    )
    await panel.getByRole('button', { name: 'Show the frontier' }).click()

    const distinct = new Set(await sampling)
    expect(distinct.size, 'the sheet went from folded to open in one step').toBeGreaterThan(4)
  })

  test('the grey bar drags the sheet open and shut', async ({ page }) => {
    const panel = await openFoldedSheet(page)
    const body = page.locator('#limes-body')
    const header = panel.locator(':scope > div').first()
    const foldButton = panel.getByRole('button', { name: /the frontier$/ })

    const drag = async (fromY: number, byY: number): Promise<void> => {
      const box = (await header.boundingBox())!
      const x = box.x + box.width / 2
      await page.mouse.move(x, box.y + fromY)
      await page.mouse.down()
      await page.mouse.move(x, box.y + fromY + byY, { steps: 8 })
      await page.mouse.up()
    }

    await drag(6, -180)
    await expect(body).toBeVisible()
    await expect(foldButton).toHaveAttribute('aria-expanded', 'true')

    // From the title row this time: the whole header is the handle, not just the bar.
    await drag(30, 180)
    await expect(body).toBeHidden()
    await expect(foldButton).toHaveAttribute('aria-expanded', 'false')
  })

  test('a drag that starts on the fold button does not click it back', async ({ page }) => {
    const panel = await openFoldedSheet(page)
    const foldButton = panel.getByRole('button', { name: 'Show the frontier' })
    const box = (await foldButton.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y - 90, { steps: 8 })
    await page.mouse.up()

    await expect(page.locator('#limes-body')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Hide the frontier' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
