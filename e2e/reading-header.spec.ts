import { expect, test } from './helpers/fixtures'

/**
 * The reading layout's header stays on screen however far down the page is
 * scrolled. The map layout needs no test: its shell never scrolls.
 */
test.describe('the reading layout header', () => {
  test('stays at the top of the window after scrolling a long page', async ({ page }) => {
    await page.goto('/licence')

    const header = page.getByRole('banner')
    await expect(header).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)

    const box = await header.boundingBox()
    expect(box?.y).toBe(0)
    await expect(header.getByRole('link', { name: 'Vestigian' })).toBeInViewport()
  })

  test('does not hide an anchored heading under itself', async ({ page }) => {
    await page.goto('/licence#credit')

    const heading = page.locator('#credit')
    await expect(heading).toBeVisible()
    await expect.poll(async () => (await heading.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(56)
  })
})
