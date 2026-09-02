import { expect, test } from './helpers/fixtures'
import { waitForMapReady } from './helpers/map'

/**
 * The offline field notebook: a Service Worker precaching the app shell, and
 * an explicit "download this area" flow that puts individual tiles into Cache
 * Storage under a name the worker recognises on its own.
 *
 * Runs only against the production build, like the rest of this suite — the
 * service worker is registered nowhere else (`devOptions.enabled: false` in
 * `nuxt.config.ts`'s `pwa` block), so a suite against `nuxt dev` would see
 * none of this.
 */

/** A close, low-zoom view, so a download in this file enumerates a handful of tiles, not thousands. */
const SMALL_AREA_HASH = '#map=11/52.0894/5.1101'

test.describe('the service worker', () => {
  test('registers and precaches the app shell', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)

    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
      { timeout: 15_000 },
    )

    const cacheNames = await page.evaluate(() => caches.keys())
    expect(cacheNames.some((name) => name.startsWith('workbox-precache'))).toBe(true)
  })
})

test.describe('downloading an area', () => {
  test('shows a real estimate for the current viewport', async ({ page }) => {
    await page.goto(`/${SMALL_AREA_HASH}`)
    await waitForMapReady(page)

    await page.getByRole('button', { name: /download this area for offline use/i }).click()

    const estimate = page.getByText(/≈.*(MB|GB).*tiles/i)
    await expect(estimate).toBeVisible({ timeout: 15_000 })
  })

  test('downloads, appears on the management page, and can be removed', async ({ page }) => {
    await page.goto(`/${SMALL_AREA_HASH}`)
    await waitForMapReady(page)

    await page.getByRole('button', { name: /download this area for offline use/i }).click()

    // Left at its default tier ("Regional") rather than picking a different
    // one: at the small area this file navigates to, that is already well
    // under a hundred tiles — what is being asserted is that the mechanism
    // works end to end, not how large a download this particular area is.
    const nameField = page.getByLabel(/^name$/i)
    await nameField.fill('E2E offline probe')

    await expect(page.getByRole('button', { name: /^download$/i })).toBeEnabled({ timeout: 15_000 })
    await page.getByRole('button', { name: /^download$/i }).click()

    await expect(page.getByText('Saved for offline use.', { exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await page.goto('/offline')
    const entry = page.getByText('E2E offline probe')
    await expect(entry).toBeVisible()

    await page.getByRole('button', { name: /remove e2e offline probe/i }).click()
    await expect(entry).toBeHidden()
  })
})

test.describe('a downloaded tile', () => {
  test('serves from cache while genuinely offline, and only what was downloaded', async ({
    page,
    context,
  }) => {
    await page.goto(`/${SMALL_AREA_HASH}`)
    await waitForMapReady(page)

    // Through the real UI, like the test above — this is the same download
    // flow, kept as a separate test because what it asserts (offline serving)
    // is a distinct claim from "the flow completes and appears in the list".
    await page.getByRole('button', { name: /download this area for offline use/i }).click()
    await expect(page.getByRole('button', { name: /^download$/i })).toBeEnabled({ timeout: 15_000 })
    await page.getByRole('button', { name: /^download$/i }).click()
    await expect(page.getByText('Saved for offline use.', { exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await context.setOffline(true)

    // z0/0/0 is the single tile covering the entire planet, and
    // `enumerateTiles` always starts at zoom 0 — so this tile is in every
    // download regardless of area or chosen detail tier, with nothing about
    // this test needing to know the exact bbox math to rely on that.
    const servedFromCache = await page.evaluate(async () => {
      const response = await fetch('/api/tiles/0/0/0.mvt')
      return { ok: response.ok, status: response.status }
    })

    // Zoom 14 is well past the default "Regional" tier's ceiling (zoom 11), so
    // this tile was never requested by the download and must still fail while
    // offline — proof the worker answers only what was actually fetched, not
    // every tile request indiscriminately.
    const uncached = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/tiles/14/8000/5000.mvt')
        return { ok: response.ok, status: response.status }
      } catch {
        return { failed: true }
      }
    })

    await context.setOffline(false)

    expect([200, 204]).toContain(servedFromCache.status)
    expect(uncached.failed).toBe(true)
  })
})
