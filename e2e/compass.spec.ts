import { expect, test } from './helpers/fixtures'
import { waitForMapReady } from './helpers/map'

/**
 * Turning the map with the phone's compass.
 *
 * Headless Chromium has no magnetometer and no touch pointer, so the sensor is
 * imitated: `(pointer: coarse)` is made true before the app starts (the button
 * is shown only to a touch device) and `deviceorientationabsolute` events are
 * dispatched by hand. That proves the wiring — permission-less start, a valid
 * reading flipping the button to pressed, the map's bearing following, and
 * switching off putting north back — not the arithmetic (unit-tested in
 * `shared/utils/__test__/compass.test.ts`) and not a real handset, which this
 * suite cannot reach.
 */
const imitateTouchDevice = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string): MediaQueryList => {
      const list = original(query)
      if (query.includes('pointer: coarse')) {
        Object.defineProperty(list, 'matches', { value: true })
      }
      return list
    }
  })
}

const sendHeading = async (page: import('@playwright/test').Page, alpha: number): Promise<void> => {
  // Flat, face up, top edge turned `alpha` degrees counter-clockwise from north.
  await page.evaluate((value) => {
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientationabsolute', {
        alpha: value,
        beta: 0,
        gamma: 0,
        absolute: true,
      }),
    )
  }, alpha)
}

test.describe('turning the map with the compass', () => {
  test('is not offered where there is no touch screen', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)

    await expect(page.getByRole('button', { name: 'Turn the map with my compass' })).toHaveCount(0)
  })

  test('turns the map to the heading and puts north back on top when switched off', async ({
    page,
  }) => {
    await imitateTouchDevice(page)
    await page.goto('/')
    await waitForMapReady(page)

    const button = page.getByRole('button', { name: 'Turn the map with my compass' })
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('aria-pressed', 'false')

    await button.click()
    // alpha 270 flat is the top edge pointing east: the reader faces 90°.
    await sendHeading(page, 270)

    const active = page.getByRole('button', {
      name: 'Stop turning the map and put north back on top',
    })
    await expect(active).toHaveAttribute('aria-pressed', 'true')

    // The arrow inside is the map's north: a map turned 90° clockwise has it at -90°.
    await expect
      .poll(async () => (await active.locator('[style*="rotate"]').getAttribute('style')) ?? '')
      .toMatch(/rotate\(-(8[89]|90)/)

    await active.click()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  test('says so when the device gives no reading', async ({ page }) => {
    await imitateTouchDevice(page)
    await page.goto('/')
    await waitForMapReady(page)

    await page.getByRole('button', { name: 'Turn the map with my compass' }).click()

    await expect(page.getByText('does not report a compass')).toBeVisible({ timeout: 6_000 })
  })
})
