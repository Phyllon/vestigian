import { expect, type Page } from '@playwright/test'

/**
 * The map's own readiness signal, and the reason this suite exists.
 *
 * `MapCanvas.vue` renders "Unfolding the map" until MapLibre fires `load`, then
 * removes it. When the CSP was missing its nonce token and Vue never mounted,
 * that placeholder stayed on screen forever while every status code said 200 —
 * a total outage that no unit test and no health check could see. Waiting for
 * it to disappear is therefore not a convenience: it is the assertion that the
 * client application actually booted.
 */
export const waitForMapReady = async (page: Page): Promise<void> => {
  await expect(page.getByRole('application', { name: 'Map of archaeological sites' })).toBeVisible()
  await expect(page.getByText('Unfolding the map')).toBeHidden({ timeout: 20_000 })
}

/**
 * Waits until tile traffic has settled.
 *
 * Counts requests rather than using `networkidle`, which Playwright discourages
 * and which a map defeats anyway — MapLibre keeps connections warm, so the page
 * is rarely idle by that definition. Settling on the tile route specifically is
 * both faster and more honest about what we are waiting for.
 */
export const waitForTiles = async (page: Page, quietMs = 800): Promise<void> => {
  let inFlight = 0
  let lastActivity = Date.now()

  const track = (delta: number) => () => {
    inFlight += delta
    lastActivity = Date.now()
  }

  const onRequest = (request: { url: () => string }) => {
    if (request.url().includes('/api/tiles/')) track(1)()
  }
  const onSettled = (request: { url: () => string }) => {
    if (request.url().includes('/api/tiles/')) track(-1)()
  }

  page.on('request', onRequest)
  page.on('requestfinished', onSettled)
  page.on('requestfailed', onSettled)

  try {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (inFlight <= 0 && Date.now() - lastActivity > quietMs) return
      await page.waitForTimeout(100)
    }
  } finally {
    page.off('request', onRequest)
    page.off('requestfinished', onSettled)
    page.off('requestfailed', onSettled)
  }
}

/** Opens the map and waits for both signals. The usual starting point. */
export const openMap = async (page: Page): Promise<void> => {
  await page.goto('/')
  await waitForMapReady(page)
  await waitForTiles(page)
}
