import { expect, test } from './helpers/fixtures'

/**
 * The Linked Places feed is the one thing this atlas publishes *for machines it
 * will never meet* — Recogito, Peripleo, the World Historical Gazetteer. A
 * malformed collection is refused wholesale by an aggregator, silently, long
 * after anyone is watching, so conformance is asserted here against the real
 * built server rather than trusted to the unit tests on the builder alone.
 *
 * Specification: https://github.com/LinkedPasts/linked-places-format (v1.3).
 */

const FEED = '/api/data/sites.lp.json'

/** The seven GeoNames feature classes LPF v1.3 permits, and nothing else. */
const FEATURE_CLASSES = new Set(['A', 'H', 'L', 'P', 'R', 'S', 'T'])

/** The four link relations LPF defines. */
const LINK_RELATIONS = new Set(['closeMatch', 'exactMatch', 'primaryTopicOf', 'seeAlso'])

interface LinkedPlaceFeature {
  '@id': string
  type: string
  properties: { title: string; fclasses: string[]; ccodes?: string[] }
  names: { toponym: string; lang: string }[]
  geometry: { type: string; coordinates: [number, number] }
  links?: { type: string; identifier: string }[]
  when?: { timespans: { start: { in: string }; end?: { in: string } }[] }
}

test.describe('Linked Places feed', () => {
  test('serves a conformant FeatureCollection as JSON-LD, open to cross-origin reuse', async ({
    request,
  }) => {
    const response = await request.get(`${FEED}?limit=50`)
    expect(response.ok()).toBeTruthy()

    // A gazetteer content-negotiates on the JSON-LD type; plain application/json
    // would leave it unable to tell this apart from the GeoJSON sibling.
    expect(response.headers()['content-type']).toContain('application/ld+json')
    expect(response.headers()['access-control-allow-origin']).toBe('*')

    const body = await response.json()
    expect(body.type).toBe('FeatureCollection')
    expect(body['@context']).toBe(
      'https://raw.githubusercontent.com/LinkedPasts/linked-places/master/linkedplaces-context-v1.1.jsonld',
    )
    expect(Array.isArray(body.features)).toBeTruthy()
    expect(body.features.length).toBeGreaterThan(0)
  })

  test('every feature carries what the specification requires', async ({ request }) => {
    const body = await (await request.get(`${FEED}?limit=200`)).json()

    for (const feature of body.features as LinkedPlaceFeature[]) {
      expect(feature['@id'], 'a feature with no URI cannot be linked to').toBeTruthy()
      expect(feature.type).toBe('Feature')
      expect(feature.properties.title).toBeTruthy()

      // Required as of v1.3 (24 June 2024) — the field a build from memory of
      // the older shape would have omitted.
      expect(feature.properties.fclasses.length).toBeGreaterThan(0)
      for (const code of feature.properties.fclasses) expect(FEATURE_CLASSES.has(code)).toBeTruthy()

      expect(feature.names.length).toBeGreaterThan(0)
      expect(feature.geometry.type).toBe('Point')

      // GeoJSON order, longitude first. Swapped, every Roman site lands in the
      // Indian Ocean and the payload still validates — the same trap the vici
      // importer already carries a warning about.
      const [longitude, latitude] = feature.geometry.coordinates
      expect(longitude).toBeGreaterThanOrEqual(-180)
      expect(longitude).toBeLessThanOrEqual(180)
      expect(latitude).toBeGreaterThanOrEqual(-90)
      expect(latitude).toBeLessThanOrEqual(90)
    }
  })

  test('links use real relations and absolute identifiers', async ({ request }) => {
    const body = await (await request.get(`${FEED}?limit=200`)).json()
    const features = body.features as LinkedPlaceFeature[]

    const linked = features.filter((feature) => (feature.links?.length ?? 0) > 0)
    expect(
      linked.length,
      'no concordances at all — the feed would reconcile against nothing',
    ).toBeGreaterThan(0)

    for (const feature of linked) {
      for (const link of feature.links!) {
        expect(LINK_RELATIONS.has(link.type)).toBeTruthy()
        expect(link.identifier).toMatch(/^https?:\/\//)
      }
    }
  })

  /**
   * Nothing here has established same-resource identity to `exactMatch`
   * strength: the identifiers were parsed out of vici.org's free-text field or
   * inferred by a distance-and-category gate. Claiming otherwise would assert
   * something this project cannot support.
   */
  test('never claims exactMatch', async ({ request }) => {
    const body = await (await request.get(`${FEED}?limit=500`)).json()
    const relations = (body.features as LinkedPlaceFeature[]).flatMap((feature) =>
      (feature.links ?? []).map((link) => link.type),
    )

    expect(relations).not.toContain('exactMatch')
  })

  /**
   * Roughly half this atlas carries no dating, and inventing one would be worse
   * than omitting it. `?dated=true` is the escape hatch for a consumer that
   * needs strict v1.3 conformance on `when`.
   */
  test('?dated=true returns only records that are genuinely dated', async ({ request }) => {
    const body = await (await request.get(`${FEED}?dated=true&limit=100`)).json()
    const features = body.features as LinkedPlaceFeature[]

    expect(features.length).toBeGreaterThan(0)
    for (const feature of features) {
      expect(feature.when).toBeTruthy()
      expect(feature.when!.timespans.length).toBeGreaterThan(0)
      // A timespan must have a start; an end alone is not expressible in LPF.
      for (const timespan of feature.when!.timespans) expect(timespan.start.in).toBeTruthy()
    }
  })

  test('respects the bounding box, so it is a feed rather than a full dump', async ({
    request,
  }) => {
    const body = await (await request.get(`${FEED}?bbox=6.0,51.5,6.9,51.9&limit=50`)).json()
    const features = body.features as LinkedPlaceFeature[]

    expect(features.length).toBeGreaterThan(0)
    for (const feature of features) {
      const [longitude, latitude] = feature.geometry.coordinates
      expect(longitude).toBeGreaterThanOrEqual(6.0)
      expect(longitude).toBeLessThanOrEqual(6.9)
      expect(latitude).toBeGreaterThanOrEqual(51.5)
      expect(latitude).toBeLessThanOrEqual(51.9)
    }
  })

  test('refuses a malformed bounding box rather than serving the whole world', async ({
    request,
  }) => {
    expect((await request.get(`${FEED}?bbox=nonsense`)).status()).toBe(400)
  })

  test('pages with offset, so the whole gazetteer is reachable and no page repeats', async ({
    request,
  }) => {
    const titlesAt = async (offset: number) => {
      const body = await (await request.get(`${FEED}?limit=5&offset=${offset}`)).json()
      return (body.features as LinkedPlaceFeature[]).map((feature) => feature['@id'])
    }

    const first = await titlesAt(0)
    const second = await titlesAt(5)
    expect(second.length).toBeGreaterThan(0)
    expect(first.filter((id) => second.includes(id))).toEqual([])
  })
})
