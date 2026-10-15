import { Parser } from 'n3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serialiseTurtle } from '../rdf'
import {
  buildOdblDataset,
  buildOdblGeoJson,
  resolveOdblFeedQuery,
  type OdblFeedPage,
  type OdblFeedRow,
} from '../odbl-feeds'

const query = { offset: 0 }

beforeEach(() => {
  // Nitro auto-imports `createError`; outside a server it is a global to stand in for.
  vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
    Object.assign(new Error(input.message), { statusCode: input.statusCode }),
  )
})

describe('resolveOdblFeedQuery', () => {
  it('gives each layer its own default page', () => {
    expect(resolveOdblFeedQuery('awmc-water', query).limit).toBe(100)
    expect(resolveOdblFeedQuery('awmc-lines', query).limit).toBe(500)
  })

  it('refuses a page larger than the layer carries instead of clamping it', () => {
    // A clamped page is shorter than the limit asked for, which a client reads as the end.
    expect(() => resolveOdblFeedQuery('awmc-water', { ...query, limit: 500 })).toThrow(
      /at most 250/,
    )
    expect(resolveOdblFeedQuery('awmc-water', { ...query, limit: 250 }).limit).toBe(250)
  })

  it('refuses a kind the layer does not have, instead of reaching the enum cast', () => {
    expect(() => resolveOdblFeedQuery('awmc-lines', { ...query, kind: 'nonsense' })).toThrow(
      /kind must be one of/,
    )
    expect(resolveOdblFeedQuery('awmc-lines', { ...query, kind: 'road' }).kind).toBe('road')
  })

  it('refuses a filter the layer does not have at all', () => {
    expect(() => resolveOdblFeedQuery('coin-hoards', { ...query, kind: 'road' })).toThrow(
      /no kind filter/,
    )
    expect(() => resolveOdblFeedQuery('awmc-lines', { ...query, source: 'osm' })).toThrow(
      /no source filter/,
    )
  })

  it('accepts a limes source, and only the ones the importer writes', () => {
    expect(resolveOdblFeedQuery('limes', { ...query, source: 'osm' }).source).toBe('osm')
    expect(() => resolveOdblFeedQuery('limes', { ...query, source: 'google' })).toThrow()
  })
})

const limesRow = (overrides: Partial<OdblFeedRow> = {}): OdblFeedRow => ({
  key: null,
  name: 'Hadrian’s Wall',
  kind: 'barrier',
  period: null,
  source: {
    key: 'ohm',
    name: 'OpenHistoricalMap contributors',
    url: 'https://www.openhistoricalmap.org/copyright',
    licence: 'CC0 1.0',
  },
  licence: null,
  properties: { sector: 'hadrians-wall', certain: true },
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [
        [-2.3, 55],
        [-2.2, 55],
      ],
    ],
  },
  wkt: 'MULTILINESTRING((-2.3 55,-2.2 55))',
  ...overrides,
})

const limes = (rows: OdblFeedRow[]): OdblFeedPage => ({ layer: 'limes', rows })

describe('buildOdblGeoJson', () => {
  it('states the licence, the credit and what was altered with the collection', () => {
    const collection = buildOdblGeoJson(limes([limesRow()]))

    expect(collection).toMatchObject({
      type: 'FeatureCollection',
      layer: 'limes',
      licence: 'ODbL 1.0',
    })
    expect(String(collection.attribution)).toContain('OpenStreetMap contributors')
    expect(String(collection.alterations)).toContain('derived from AWMC')
  })

  it('names both terms of a layer published under two licences', () => {
    const collection = buildOdblGeoJson({ layer: 'coin-hoards', rows: [] })
    expect(collection.licence).toBe('ODbL 1.0 + CC BY-NC 3.0')
    expect(collection.licenceUrls).toEqual([
      'https://opendatacommons.org/licenses/odbl/1-0/',
      'https://creativecommons.org/licenses/by-nc/3.0/',
    ])
  })

  it('puts each segment’s own source and its licence on the feature', () => {
    const [feature] = buildOdblGeoJson(limes([limesRow()])).features as Array<{
      properties: Record<string, unknown>
    }>
    expect(feature!.properties).toMatchObject({
      source: 'ohm',
      sourceLicence: 'CC0 1.0',
      sector: 'hadrians-wall',
      certain: true,
    })
  })

  it('leaves a feature with no stable key without an id rather than inventing one', () => {
    const [feature] = buildOdblGeoJson(limes([limesRow()])).features as Array<{ id?: unknown }>
    expect(feature).not.toHaveProperty('id')
  })
})

describe('buildOdblDataset', () => {
  it('turns a page into Turtle a parser reads back, with the licence of its source', async () => {
    const dataset = buildOdblDataset(limes([limesRow()]), 'https://vestigian.example/')
    expect(dataset.iri).toBe('https://vestigian.example/api/odbl/limes.ttl')

    const quads = new Parser({ format: 'text/turtle' }).parse(await serialiseTurtle(dataset))
    const wkt = quads.find(
      (q) => q.predicate.value === 'http://www.opengis.net/ont/geosparql#asWKT',
    )
    expect(wkt?.object.value).toBe('MULTILINESTRING((-2.3 55,-2.2 55))')

    const licences = quads
      .filter((q) => q.predicate.value === 'http://purl.org/dc/terms/license')
      .map((q) => q.object.value)
    expect(licences).toContain('https://creativecommons.org/publicdomain/zero/1.0/')
    expect(licences).toContain('https://opendatacommons.org/licenses/odbl/1-0/')
  })

  it('keys a survey site by the Survey’s own id, as a fragment of the feed', () => {
    const dataset = buildOdblDataset(
      {
        layer: 'survey-sites',
        rows: [
          {
            survey_id: 'MS-004712',
            name: 'CHYTODDEN',
            source: 'cornwall-her',
            kind: 'enclosed-settlement',
            period_keys: [],
            period_from: -800,
            period_to: 410,
            period_basis: 'source-vocabulary',
            destroyed: false,
            uncertain: false,
            evidence: null,
            lon: -5.1,
            lat: 50.3,
          },
        ],
      },
      'https://vestigian.example',
    )
    expect(dataset.features[0]!.iri).toBe(
      'https://vestigian.example/api/odbl/survey-sites.ttl#MS-004712',
    )
    expect(dataset.features[0]!.wkt).toBe('POINT(-5.1 50.3)')
  })
})
