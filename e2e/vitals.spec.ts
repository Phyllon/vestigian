import { expect, test } from './helpers/fixtures'
import { waitForMapReady } from './helpers/map'

/**
 * The browser-timing beacon and the metrics it feeds. Request-level rather than
 * browser-driven: the plugin that sends it is skipped in development and under
 * Do Not Track, and what matters here is what the server will and will not keep.
 */
test.describe('browser timings', () => {
  test('accepts a batch and answers 204 with nothing to read', async ({ request }) => {
    const response = await request.post('/api/vitals', {
      data: [
        { name: 'LCP', value: 1800, device: 'compact' },
        { name: 'CLS', value: 0.04, device: 'wide' },
        { name: 'map-load', value: 2400, device: 'compact' },
      ],
    })

    expect(response.status()).toBe(204)
    expect(await response.text()).toBe('')
  })

  test('refuses a name it does not recognise', async ({ request }) => {
    const response = await request.post('/api/vitals', {
      data: [{ name: 'user-email', value: 1, device: 'wide' }],
    })

    expect(response.status()).toBe(400)
  })

  test('records only aggregates, with no identifier in any label', async ({ request }) => {
    await request.post('/api/vitals', { data: [{ name: 'FCP', value: 900, device: 'wide' }] })

    const metrics = await (await request.get('/api/metrics')).text()
    const vitalLines = metrics.split('\n').filter((line) => line.startsWith('web_vital_'))

    expect(vitalLines.length).toBeGreaterThan(0)
    // Label names are the whole of what can identify anything: name, device,
    // rating, and the histogram's own `le`. Nothing else may ever appear.
    for (const line of vitalLines) {
      const labelBlock = line.slice(line.indexOf('{') + 1, line.indexOf('}'))
      const labels = labelBlock.split(',').map((pair) => pair.split('=')[0] ?? '')
      expect(labels.every((label) => ['name', 'device', 'rating', 'le'].includes(label))).toBe(true)
    }
  })

  test('exposes the catalogue gauges as counts only', async ({ request }) => {
    const metrics = await (await request.get('/api/metrics')).text()

    expect(metrics).toContain('atlas_sites{status="approved"}')
    expect(metrics).toContain('atlas_revisions_oldest_pending_seconds')
    // Aggregates only: no per-user or per-site label may ever be minted.
    expect(metrics).not.toMatch(/atlas_\w+\{[^}]*(email|user|slug|id)=/)
  })

  test('what the browser sends holds only the measurement, and nothing is stored on the device', async ({
    page,
    context,
  }) => {
    const beacons: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/vitals') && request.method() === 'POST') {
        beacons.push(request.postData() ?? '')
      }
    })

    await page.goto('/')
    await waitForMapReady(page)

    // The plugin flushes when the page is hidden or closed.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expect.poll(() => beacons.length, { timeout: 15_000 }).toBeGreaterThan(0)

    for (const body of beacons) {
      const reports = JSON.parse(body) as Record<string, unknown>[]
      for (const report of reports) {
        // Three fields and no more: no route, id, timestamp, user agent or address.
        expect(Object.keys(report).sort()).toEqual(['device', 'name', 'value'])
      }
    }

    // Sending the numbers must not have written anything either: the only
    // cookie a first visit sets is the interface language, and no storage key
    // belongs to the measurement.
    const cookieNames = (await context.cookies()).map((cookie) => cookie.name)
    expect(cookieNames.every((name) => name === 'vestigian-locale')).toBe(true)

    const storageKeys = await page.evaluate(() => [
      ...Object.keys(localStorage),
      ...Object.keys(sessionStorage),
    ])
    expect(storageKeys.some((key) => /vital|metric|measure|perf/i.test(key))).toBe(false)
  })
})
