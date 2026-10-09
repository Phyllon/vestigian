import { expect, test } from './helpers/fixtures'
import { waitForMapReady } from './helpers/map'

/**
 * The first-visit introduction. Every other spec starts as a browser that has
 * already answered it (`answerIntroTour`); this one starts fresh.
 */
test.describe('introduction for new visitors', () => {
  test.use({ isFirstVisit: true })

  test('welcomes a first visit, walks the controls, and is not offered again once skipped', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForMapReady(page)

    const welcome = page.getByRole('dialog', { name: 'Welcome to Vestigian' })
    await expect(welcome).toBeVisible({ timeout: 15_000 })

    // The page behind it is out of reach for pointer, keyboard and screen reader alike.
    await expect(page.locator('#__nuxt')).toHaveAttribute('inert', '')

    await welcome.getByRole('button', { name: 'Start the tour' }).click()

    const searchStep = page.getByRole('dialog', { name: 'Search' })
    await expect(searchStep).toBeVisible()
    await expect(searchStep.getByText('Step 2 of')).toBeVisible()
    await expect(searchStep.getByRole('button', { name: 'Next' })).toBeFocused()

    await searchStep.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('dialog', { name: 'Overlays' })).toBeVisible()

    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()

    await page.getByRole('button', { name: 'Skip intro' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#__nuxt')).not.toHaveAttribute('inert', '')

    // The answer is remembered on the device — a reload does not ask again.
    await page.reload()
    await waitForMapReady(page)
    // Past the page's own start-up delay, so "not shown" is a real observation.
    await page.waitForFunction(() => performance.now() > 2_500)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('vestigian-intro-tour'))).toBe('done')
  })

  test('is left with Escape, and can be replayed from the menu', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)

    await expect(page.getByRole('dialog', { name: 'Welcome to Vestigian' })).toBeVisible({
      timeout: 15_000,
    })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Show the introduction' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Vestigian' })).toBeVisible()
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 667 } })

    test('keeps every step inside the screen', async ({ page }) => {
      await page.goto('/')
      await waitForMapReady(page)

      await page
        .getByRole('dialog', { name: 'Welcome to Vestigian' })
        .getByRole('button', { name: 'Start the tour' })
        .click({ timeout: 15_000 })

      const viewport = page.viewportSize()
      if (!viewport) throw new Error('no viewport')

      for (let step = 0; step < 6; step += 1) {
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        // Polled, because the spotlight glides between controls and the card
        // follows it; the assertion is about where it comes to rest.
        await expect
          .poll(async () => {
            const box = await dialog.boundingBox()
            if (!box) return false
            const isInsideHorizontally = box.x >= 0 && box.x + box.width <= viewport.width
            const isInsideVertically = box.y >= 0 && box.y + box.height <= viewport.height
            return isInsideHorizontally && isInsideVertically
          })
          .toBe(true)
        await dialog.getByRole('button', { name: 'Next' }).click()
      }
    })
  })
})
