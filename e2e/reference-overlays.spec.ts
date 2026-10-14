import { expect, test } from './helpers/fixtures'
import { openMap, openOverlays, openPeriods, showSites, toggleOverlay } from './helpers/map'

/**
 * The reference layers added with Itiner-e, Nomisma, the Wikidata monuments,
 * I.Sicily, the Atlas of Hillforts, the road audit and Cliopatria. Each is a third party's data under its own licence, so
 * what is asserted here is the part that is a legal obligation as much as a feature:
 * the credit appears with the layer and leaves with it, and the one thing deliberately
 * left out (I.Sicily's photographs) stays out.
 */
const OVERLAYS = [
  { label: 'Sicilian inscriptions', credit: 'I.Sicily' },
  { label: 'Roman roads', credit: 'Itiner-e' },
  { label: 'Roman monuments', credit: 'Wikidata' },
  { label: 'Mints', credit: 'Nomisma' },
  { label: 'Hillforts', credit: 'Atlas of Hillforts' },
  { label: 'Road audit', credit: 'calculated here from' },
]

test.describe('the reference overlays', () => {
  test('are offered in the overlay menu, off by default', async ({ page }) => {
    await openMap(page)
    await openOverlays(page)

    for (const { label } of OVERLAYS) {
      await expect(page.getByRole('menuitemcheckbox', { name: label })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    }

    // The neighbouring realms are not an overlay of their own: their switch sits under
    // the period scrubber, in the "Ancient empires" panel.
    await expect(page.getByRole('menuitemcheckbox', { name: 'Neighbouring realms' })).toHaveCount(0)
  })

  for (const { label, credit } of OVERLAYS) {
    test(`credit ${credit} while ${label} is switched on, and only then`, async ({ page }) => {
      await openMap(page)
      const attribution = page.locator('.maplibregl-ctrl-attrib')
      await expect(attribution).not.toContainText(credit)

      await toggleOverlay(page, label)
      await expect(attribution).toContainText(credit)

      await toggleOverlay(page, label)
      await expect(attribution).not.toContainText(credit)
    })
  }
})

test.describe('the neighbouring realms switch', () => {
  test('sits under the period scrubber and appears only once a date is chosen', async ({
    page,
  }) => {
    await openMap(page)
    await openPeriods(page)

    const realms = page.getByRole('switch', { name: 'Neighbouring realms' })
    await expect(realms).toHaveCount(0)

    const slider = page.getByRole('slider', { name: 'The Roman Empire, over time' })
    await expect(slider).toHaveAttribute('aria-valuemax', /^[1-9]\d*$/)
    await slider.press('ArrowRight')

    await expect(realms).toBeVisible()
    await expect(realms).toBeChecked()

    // Off again, the realms' tiles stop being requested and the switch stays where it is.
    await realms.click()
    await expect(realms).not.toBeChecked()
  })
})

test.describe('the key', () => {
  test('is empty, and says so, until an overlay is switched on', async ({ page }) => {
    await openMap(page)
    await page.getByRole('button', { name: 'Key' }).click()

    await expect(page.getByText('The key is empty for now')).toBeVisible()
    await expect(page.getByText('Settlement', { exact: true })).toHaveCount(0)
  })

  test('explains the sites only while they are drawn', async ({ page }) => {
    await openMap(page)
    await showSites(page)
    await page.getByRole('button', { name: 'Key' }).click()

    await expect(page.getByText('Settlement', { exact: true })).toBeVisible()
    await expect(page.getByText('The key is empty for now')).toHaveCount(0)
  })

  test('lists a mark for every kind of monument while they are switched on', async ({ page }) => {
    await openMap(page)
    await toggleOverlay(page, 'Roman monuments')
    await page.getByRole('button', { name: 'Key' }).click()

    for (const kind of ['Theatre', 'Amphitheatre', 'Bath', 'Forum', 'Mithraeum']) {
      await expect(page.locator('#map-legend').getByText(kind, { exact: true })).toBeVisible()
    }
  })
})

test.describe('the reference tile endpoints', () => {
  test('serve a vector tile for each layer, and answer 404 for an unknown one', async ({
    request,
  }) => {
    // 6/33/22 covers Rome and its neighbourhood; the other layers are thin at this zoom.
    const roads = await request.get('/api/tiles/reference/roman-roads/6/33/22.mvt')
    expect(roads.status()).toBe(200)
    expect(roads.headers()['content-type']).toContain('application/vnd.mapbox-vector-tile')
    expect((await roads.body()).length).toBeGreaterThan(0)

    for (const layer of ['mints', 'monuments', 'isicily', 'hillforts']) {
      const response = await request.get(`/api/tiles/reference/${layer}/4/8/5.mvt`)
      expect([200, 204]).toContain(response.status())
    }

    // The layer name is a path segment, so it must never reach a table name unchecked.
    expect((await request.get('/api/tiles/reference/sites/4/8/5.mvt')).status()).toBe(404)
    expect((await request.get('/api/tiles/reference/mints/99/0/0.mvt')).status()).toBe(400)
  })

  test('serve the neighbouring realms for a year, and refuse one outside the imported span', async ({
    request,
  }) => {
    const inRange = await request.get('/api/tiles/antiquity-polities/-200/4/8/5.mvt')
    expect([200, 204]).toContain(inRange.status())

    for (const year of ['-510', '477', 'abc']) {
      expect((await request.get(`/api/tiles/antiquity-polities/${year}/4/8/5.mvt`)).status()).toBe(
        400,
      )
    }
  })
})

test.describe('an I.Sicily inscription', () => {
  test('is served as data, with its licence and without a photograph', async ({ request }) => {
    const response = await request.get('/api/isicily-inscriptions/ISic000001')
    expect(response.ok()).toBeTruthy()

    const body = await response.json()
    expect(body).toMatchObject({ isicilyId: 'ISic000001', licence: 'CC-BY-4.0' })
    expect(body.sourceUrl).toBe('https://sicily.classics.ox.ac.uk/inscription/ISic000001')
    // The photographs are not licensed for reuse; nothing in the record points at one.
    expect(JSON.stringify(body)).not.toMatch(/\.(jpg|jpeg|png|tif)/i)
  })

  test('refuses a malformed identifier and answers 404 for an unknown one', async ({ request }) => {
    expect((await request.get('/api/isicily-inscriptions/not-an-id')).status()).toBe(400)
    expect((await request.get('/api/isicily-inscriptions/ISic99999999')).status()).toBe(404)
  })

  test('has a page that says where the photograph is instead of showing it', async ({ page }) => {
    await page.goto('/inscriptions/sicily/ISic000001')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Funerary inscription of Zethus' }),
    ).toBeVisible()
    await expect(page.getByText('Photographs are not reproduced here')).toBeVisible()
    await expect(page.getByRole('link', { name: /View on I\.Sicily/ })).toHaveAttribute(
      'href',
      'https://sicily.classics.ox.ac.uk/inscription/ISic000001',
    )
  })
})
