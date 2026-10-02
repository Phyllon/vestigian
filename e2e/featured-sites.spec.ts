import { expect, test } from './helpers/fixtures'
import { IMGPROXY_OVER_HTTP, watchForProblems } from './helpers/console'
import { waitForMapReady } from './helpers/map'

test.describe('featured sites nearby', () => {
  test('lists sites around the camera and opens one with its detail panel', async ({ page }) => {
    // Thumbnails go through imgproxy, refused over plain HTTP in this setup.
    const problems = watchForProblems(page, { ignore: [IMGPROXY_OVER_HTTP] })

    await page.goto('/#map=9/47.5/8.5')
    await waitForMapReady(page)

    const trigger = page.getByRole('button', { name: 'Show featured sites nearby' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()

    const list = page.getByRole('region', { name: 'Featured nearby' })
    await expect(list).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hide featured sites nearby' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    const rows = list.getByRole('listitem')
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0)

    await rows.first().getByRole('button').click()
    await expect(page.getByRole('complementary', { name: 'Site details' })).toBeVisible()

    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
  })

  test('closes with Escape', async ({ page }) => {
    await page.goto('/#map=9/47.5/8.5')
    await waitForMapReady(page)

    await page.getByRole('button', { name: 'Show featured sites nearby' }).click()
    const list = page.getByRole('region', { name: 'Featured nearby' })
    await expect(list).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
  })
})
