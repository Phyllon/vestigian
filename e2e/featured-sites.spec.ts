import { expect, test } from './helpers/fixtures'
import { IMGPROXY_OVER_HTTP, watchForProblems } from './helpers/console'
import { openMapSettings, waitForMapReady } from './helpers/map'

/**
 * The "featured nearby" list is a switch in the map settings, remembered in
 * `localStorage`, not a button that opens a panel for the session. Every
 * browser context here starts empty, so each test begins with the list off.
 */
const FEATURED_URL = '/#map=9/47.5/8.5'

const switchFeaturedOn = async (page: Parameters<typeof openMapSettings>[0]): Promise<void> => {
  await openMapSettings(page)
  const featured = page.getByRole('switch', { name: 'Featured nearby' })
  await expect(featured).toHaveAttribute('aria-checked', 'false')
  await featured.click()
  await expect(featured).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
}

test.describe('featured sites nearby', () => {
  test('is off until switched on, then lists the sites around the view and opens one', async ({
    page,
  }) => {
    // Thumbnails go through imgproxy, refused over plain HTTP in this setup.
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })

    await page.goto(FEATURED_URL)
    await waitForMapReady(page)

    const list = page.getByRole('region', { name: 'Featured nearby' })
    await expect(list, 'a reader who never touches the switch sees nothing').toHaveCount(0)

    await switchFeaturedOn(page)
    await expect(list).toBeVisible()

    const rows = list.getByRole('listitem')
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0)

    const viewport = page.viewportSize()!
    const box = (await list.boundingBox())!
    expect(box.height, 'never more than half the screen').toBeLessThanOrEqual(
      viewport.height / 2 + 1,
    )

    await rows.first().getByRole('button').click()
    await expect(page.getByRole('complementary', { name: 'Site details' })).toBeVisible()

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('remembers the choice across a reload, and forgets it when turned off', async ({ page }) => {
    await page.goto(FEATURED_URL)
    await waitForMapReady(page)
    await switchFeaturedOn(page)

    const list = page.getByRole('region', { name: 'Featured nearby' })
    await expect(list).toBeVisible()

    await page.reload()
    await waitForMapReady(page)
    await expect(list, 'the saved choice is applied after a reload').toBeVisible()

    await list.getByRole('button', { name: 'Turn off featured nearby' }).click()
    await expect(list).toHaveCount(0)

    await page.reload()
    await waitForMapReady(page)
    await expect(list, 'turning it off is remembered too').toHaveCount(0)
  })

  test('big picture adds the photograph credit and is remembered', async ({ page }) => {
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })

    await page.goto(FEATURED_URL)
    await waitForMapReady(page)
    await switchFeaturedOn(page)

    const list = page.getByRole('region', { name: 'Featured nearby' })
    const rows = list.getByRole('listitem')
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(list.getByText(/^Photo: /), 'the compact list carries no credit line').toHaveCount(
      0,
    )

    const bigPicture = list.getByRole('button', { name: 'Big picture' })
    await expect(bigPicture).toHaveAttribute('aria-pressed', 'false')
    await bigPicture.click()
    await expect(bigPicture).toHaveAttribute('aria-pressed', 'true')
    await expect(list.getByText(/^Photo: /).first()).toBeVisible()

    await page.reload()
    await waitForMapReady(page)
    await expect(list.getByRole('button', { name: 'Big picture' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test("big picture is not among the settings: it is the list's own header button", async ({
    page,
  }) => {
    await page.goto(FEATURED_URL)
    await waitForMapReady(page)

    await openMapSettings(page)
    await expect(page.getByRole('switch', { name: 'Big picture' })).toHaveCount(0)
  })

  test('closes with Escape from inside the list', async ({ page }) => {
    await page.goto(FEATURED_URL)
    await waitForMapReady(page)
    await switchFeaturedOn(page)

    const list = page.getByRole('region', { name: 'Featured nearby' })
    await expect(list).toBeVisible()

    await list.getByRole('button', { name: 'Big picture' }).focus()
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 667 } })

    test('shows one large photograph with the text underneath, clear of the controls', async ({
      page,
    }) => {
      await page.goto(FEATURED_URL)
      await waitForMapReady(page)
      await switchFeaturedOn(page)

      const list = page.getByRole('region', { name: 'Featured nearby' })
      await expect(list).toBeVisible()

      const rows = list.getByRole('listitem')
      await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0)
      const compactBox = (await list.boundingBox())!
      expect(compactBox.height, 'the compact list is half the screen at most').toBeLessThanOrEqual(
        667 / 2 + 1,
      )

      await list.getByRole('button', { name: 'Big picture' }).click()

      const first = rows.first()
      const photo = (await first.locator('img').boundingBox())!
      const title = (await first.locator('span').first().boundingBox())!
      const listBox = (await list.boundingBox())!
      const settingsBox = (await page.getByRole('button', { name: 'Map settings' }).boundingBox())!

      expect(photo.height, 'the photograph is nearly half the screen on its own').toBeGreaterThan(
        667 * 0.35,
      )
      expect(
        title.y,
        'the text sits underneath the photograph, not beside it',
      ).toBeGreaterThanOrEqual(photo.y + photo.height - 1)
      expect(
        listBox.x + listBox.width <= settingsBox.x + 1,
        'the sheet stops short of the control column, which holds the switch that turns it off',
      ).toBe(true)

      // The detail sheet takes the same edge: the list steps aside without being switched off.
      await rows.first().getByRole('button').click()
      await expect(page.getByRole('complementary', { name: 'Site details' })).toBeVisible()
      await expect(list).toBeHidden()
    })
  })
})
