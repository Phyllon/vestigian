import { Parser, type Quad } from 'n3'
import { describe, expect, it } from 'vitest'
import { serialiseTurtle, type RdfDataset, type RdfFeature } from '../rdf'

const feature = (overrides: Partial<RdfFeature> = {}): RdfFeature => ({
  iri: 'https://vestigian.example/site/castra-vetera',
  label: 'Castra Vetera',
  kind: 'fortification',
  description: 'Legionary fortress on the Rhine.',
  featureClass: 'S',
  period: { from: -12, to: 70 },
  wkt: 'POINT(6.45 51.66)',
  licence: 'CC-BY-SA-3.0',
  attribution: 'vici.org contributors',
  source: null,
  links: [{ relation: 'closeMatch', url: 'https://pleiades.stoa.org/places/109240' }],
  extra: { countryCode: 'DE', certain: true, hoardCount: 3 },
  ...overrides,
})

const dataset = (features: RdfFeature[], overrides: Partial<RdfDataset> = {}): RdfDataset => ({
  iri: 'https://vestigian.example/api/data/sites.ttl',
  title: 'Vestigian: approved sites',
  credit: 'Vestigian, built on vici.org',
  licences: ['CC0-1.0'],
  rights: null,
  alterations: null,
  features,
  ...overrides,
})

/** Read it back with a real Turtle parser: a string match would pass on invalid syntax. */
const parse = async (dataset_: RdfDataset): Promise<Quad[]> =>
  new Parser({ format: 'text/turtle' }).parse(await serialiseTurtle(dataset_))

const objectsOf = (quads: Quad[], predicate: string, subject?: string): string[] =>
  quads
    .filter((q) => q.predicate.value === predicate && (!subject || q.subject.value === subject))
    .map((q) => q.object.value)

describe('serialiseTurtle', () => {
  it('writes Turtle a standard parser reads back', async () => {
    const quads = await parse(dataset([feature()]))
    expect(quads.length).toBeGreaterThan(10)
  })

  it('says what the dataset is and under which licence', async () => {
    const quads = await parse(dataset([feature()], { alterations: 'Simplified to 20 m.' }))
    const iri = 'https://vestigian.example/api/data/sites.ttl'

    expect(objectsOf(quads, 'http://purl.org/dc/terms/title', iri)).toEqual([
      'Vestigian: approved sites',
    ])
    expect(objectsOf(quads, 'http://purl.org/dc/terms/license', iri)).toEqual([
      'https://creativecommons.org/publicdomain/zero/1.0/',
    ])
    expect(objectsOf(quads, 'http://purl.org/dc/terms/provenance', iri)).toEqual([
      'Simplified to 20 m.',
    ])
  })

  it('gives each feature its geometry as GeoSPARQL WKT, longitude first', async () => {
    const quads = await parse(dataset([feature()]))
    const wkt = quads.find(
      (q) => q.predicate.value === 'http://www.opengis.net/ont/geosparql#asWKT',
    )

    expect(wkt?.object.value).toBe('POINT(6.45 51.66)')
    expect((wkt?.object as { datatype: { value: string } }).datatype.value).toBe(
      'http://www.opengis.net/ont/geosparql#wktLiteral',
    )
  })

  it('links a record to its concordance with skos:closeMatch', async () => {
    const quads = await parse(dataset([feature()]))
    expect(objectsOf(quads, 'http://www.w3.org/2004/02/skos/core#closeMatch')).toEqual([
      'https://pleiades.stoa.org/places/109240',
    ])
  })

  it('writes a BC year as a signed xsd:gYear, in the source’s own numbering', async () => {
    const quads = await parse(dataset([feature()]))
    expect(objectsOf(quads, 'http://www.w3.org/ns/dcat#startDate')).toEqual(['-0012'])
    expect(objectsOf(quads, 'http://www.w3.org/ns/dcat#endDate')).toEqual(['0070'])
  })

  it('names a licence by URL, and falls back to text for one it cannot place', async () => {
    const quads = await parse(
      dataset([
        feature({ licence: 'CC-BY-SA-3.0' }),
        feature({ iri: 'https://vestigian.example/site/b', licence: 'OGL' }),
      ]),
    )
    expect(objectsOf(quads, 'http://purl.org/dc/terms/license')).toContain(
      'https://creativecommons.org/licenses/by-sa/3.0/',
    )
    expect(objectsOf(quads, 'http://purl.org/dc/terms/rights')).toEqual(['OGL'])
  })

  it('carries values with no standard term as typed schema.org PropertyValues', async () => {
    const quads = await parse(dataset([feature()]))
    const names = objectsOf(quads, 'https://schema.org/name')

    expect(names.sort()).toEqual(['certain', 'countryCode', 'hoardCount'])
    const certain = quads.find(
      (q) => q.predicate.value === 'https://schema.org/value' && q.object.value === 'true',
    )
    expect((certain?.object as { datatype: { value: string } }).datatype.value).toBe(
      'http://www.w3.org/2001/XMLSchema#boolean',
    )
  })

  it('drops a null value rather than writing an empty one', async () => {
    const quads = await parse(dataset([feature({ extra: { evidence: null } })]))
    expect(objectsOf(quads, 'https://schema.org/name')).toEqual([])
  })

  it('uses a blank node where the source has no stable key', async () => {
    const quads = await parse(dataset([feature({ iri: null })]))
    const typed = quads.find(
      (q) =>
        q.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
        q.object.value === 'http://www.opengis.net/ont/geosparql#Feature',
    )
    expect(typed?.subject.termType).toBe('BlankNode')
  })

  it('escapes text a user typed rather than letting it end the literal', async () => {
    const quads = await parse(dataset([feature({ label: 'Villa "Rustica"\nsecond line \\ end' })]))
    expect(objectsOf(quads, 'http://www.w3.org/2000/01/rdf-schema#label')).toEqual([
      'Villa "Rustica"\nsecond line \\ end',
    ])
  })
})
