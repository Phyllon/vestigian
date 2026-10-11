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

/**
 * Turns on the vici-sourced site/tracing overlay, off by default so a first
 * visit requests no data tiles at all. Anything that needs to see sites,
 * tracings or the contributed limes forts on screen has to switch it on
 * first — see `isShowingSites` in `useBasemapStyle`.
 */
export const showSites = async (page: Page): Promise<void> => {
  await toggleOverlay(page, 'Sites')
}

/**
 * Opens the overlay switcher — its own control since the overlays stopped
 * being readings of one particular basemap, so no longer reachable through
 * the basemap menu. See `OverlaySwitcher.vue`.
 */
export const openOverlays = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /^Overlays:/ }).click()
}

export const toggleOverlay = async (page: Page, name: string): Promise<void> => {
  await openOverlays(page)
  await page.getByRole('menuitemcheckbox', { name }).click()
  // A toggle deliberately leaves the menu open (it changes the map behind it
  // rather than navigating anywhere) — closed here so a caller's next
  // interaction with a control opens its menu instead of closing this one.
  await page.keyboard.press('Escape')
}

/**
 * Opens the period scrubber's own control — extracted out of the basemap
 * switcher (`PeriodSwitcher.vue`) the same way the overlay toggles were, once
 * the extent-over-time fill stopped being a reading of the Barrington sheet
 * specifically and started drawing over any basemap.
 */
export const openPeriods = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /^Ancient empires:/ }).click()
}

/**
 * Opens the map settings — the switches for how the map is read (featured
 * nearby, every site as its own marker). One popover in
 * the bottom-right column, see `SettingsMenu.vue`. Left open, like the overlay
 * menu: a caller flips what it needs and dismisses it with Escape.
 */
export const openMapSettings = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Map settings' }).click()
  await expect(page.getByRole('switch', { name: 'Featured nearby' })).toBeVisible()
}
