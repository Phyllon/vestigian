import { expect, test } from './helpers/fixtures'

/**
 * The ODbL reuse feeds are an offer the licence requires (§4.6), so the
 * promises worth asserting are the ones a consumer builds on: every layer
 * answers in both formats, the licence travels with the data, and the paging
 * rules cannot silently truncate a walk.
 */

const LAYERS = [
  'awmc-water',
  'awmc-lines',
  'awmc-areas',
  'awmc-regions',
  'awmc-features',
  'coin-hoards',
  'limes',
  'survey-sites',
]

test.describe('ODbL feeds', () => {
  for (const layer of LAYERS) {
    test(`${layer} answers as GeoJSON that names its licence and credit`, async ({ request }) => {
      const response = await request.get(`/api/odbl/${layer}.geojson?limit=5`)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/geo+json')
      expect(response.headers()['access-control-allow-origin']).toBe('*')
      expect(response.headers()['link']).toContain('rel="license"')

      const collection = await response.json()
      expect(collection.type).toBe('FeatureCollection')
      expect(collection.licence).toContain('ODbL 1.0')
      expect(collection.attribution).toBeTruthy()
    })

    test(`${layer} answers as Turtle with the dataset's licence`, async ({ request }) => {
      const response = await request.get(`/api/odbl/${layer}.ttl?limit=5`)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('text/turtle')

      const body = await response.text()
      expect(body).toContain('a dcat:Dataset')
      expect(body).toContain('<https://opendatacommons.org/licenses/odbl/1-0/>')
    })
  }

  test('says the coin hoards are also non-commercial, because CHRR states both terms', async ({
    request,
  }) => {
    const collection = await (await request.get('/api/odbl/coin-hoards.geojson?limit=1')).json()
    expect(collection.licence).toBe('ODbL 1.0 + CC BY-NC 3.0')
    expect(collection.attribution).toContain('non-commercial')
  })

  test('names each frontier segment’s own source and licence', async ({ request }) => {
    const collection = await (await request.get('/api/odbl/limes.geojson?limit=20')).json()
    expect(collection.features.length).toBeGreaterThan(0)
    for (const feature of collection.features) {
      expect(feature.properties.source).toBeTruthy()
      expect(feature.properties.sourceLicence).toBeTruthy()
    }
  })

  test('refuses what it cannot answer honestly instead of shortening or crashing', async ({
    request,
  }) => {
    // A page clamped below the limit asked for reads as the end of the data.
    expect((await request.get('/api/odbl/awmc-water.geojson?limit=1000')).status()).toBe(400)
    expect((await request.get('/api/odbl/awmc-lines.geojson?kind=nonsense')).status()).toBe(400)
    expect((await request.get('/api/odbl/coin-hoards.geojson?kind=road')).status()).toBe(400)
    expect((await request.get('/api/odbl/antiquity_places.geojson')).status()).toBe(404)
    expect((await request.get('/api/odbl/limes.json')).status()).toBe(404)
  })

  test('pages without repeating a record', async ({ request }) => {
    const first = await (await request.get('/api/odbl/awmc-features.geojson?limit=5')).json()
    const second = await (
      await request.get('/api/odbl/awmc-features.geojson?limit=5&offset=5')
    ).json()
    const key = (feature: { geometry: unknown }) => JSON.stringify(feature.geometry)

    const seen = new Set(first.features.map(key))
    for (const feature of second.features) expect(seen.has(key(feature))).toBe(false)
  })

  test('serves the site records as Turtle with GeoSPARQL geometry', async ({ request }) => {
    const response = await request.get('/api/data/sites.ttl?limit=5')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/turtle')

    const body = await response.text()
    expect(body).toContain('geo:asWKT')
    expect(body).toContain('dcterms:license')
    // Nothing from a reference layer: those have their own feeds under their own terms.
    expect(body).not.toContain('opendatacommons.org')
  })
})
