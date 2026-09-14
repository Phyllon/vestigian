import { describe, expect, it } from 'vitest'
import {
  LINKED_PLACES_CONTEXT,
  buildLinkedPlaceFeature,
  buildLinkedPlacesCollection,
  featureClassesFor,
  linkRelationFor,
  toIsoYear,
  type LinkedPlaceInput,
} from '../linkedPlaces'

/**
 * Asserted against the real Linked Places specification (v1.3, 24 June 2024),
 * fetched while writing this rather than recalled. A feed that claims LPF
 * conformance and does not have it is worse than no feed: an aggregator refuses
 * the whole collection, and it does so long after anybody is watching.
 */

const input = (overrides: Partial<LinkedPlaceInput> = {}): LinkedPlaceInput => ({
  id: 'https://vestigian.example/site/castra-vetera',
  title: 'Castra Vetera',
  category: 'fortification',
  longitude: 6.45,
  latitude: 51.66,
  countryCode: 'DE',
  summary: 'Legionary fortress on the Rhine.',
  periodFrom: -12,
  periodTo: 70,
  identifiers: [],
  licence: 'CC-BY-SA-3.0',
  attribution: 'vici.org contributors',
  ...overrides,
})

describe('buildLinkedPlaceFeature', () => {
  it('emits every field LPF v1.3 requires', () => {
    const feature = buildLinkedPlaceFeature(input())

    expect(feature['@id']).toBe('https://vestigian.example/site/castra-vetera')
    expect(feature.type).toBe('Feature')
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [6.45, 51.66] })
    expect(feature.properties).toMatchObject({ title: 'Castra Vetera', fclasses: ['S'] })
    expect(feature.names).toEqual([{ toponym: 'Castra Vetera', lang: 'en' }])
    expect(feature.when).toEqual({ timespans: [{ start: { in: '-0012' }, end: { in: '0070' } }] })
  })

  /**
   * `fclasses` became required in v1.3 (24 June 2024). Building from memory of
   * the older shape would have omitted it silently — this is the assertion that
   * would have caught that.
   */
  it('always carries fclasses, which v1.3 made required', () => {
    const feature = buildLinkedPlaceFeature(input({ category: 'other' }))

    expect((feature.properties as Record<string, unknown>).fclasses).toEqual(['S'])
  })

  it('puts coordinates in GeoJSON order, longitude first', () => {
    const feature = buildLinkedPlaceFeature(input({ longitude: 6.45, latitude: 51.66 }))

    expect((feature.geometry as { coordinates: number[] }).coordinates).toEqual([6.45, 51.66])
  })

  /**
   * Half this atlas has no dating at all. Emitting a `when` anyway would mean
   * inventing a temporal scope for 29,905 places, which is a worse failure than
   * an absent optional-in-practice field.
   */
  it('omits `when` entirely rather than inventing a date', () => {
    const feature = buildLinkedPlaceFeature(input({ periodFrom: null, periodTo: null }))

    expect(feature.when).toBeUndefined()
  })

  it('uses a lone end year as both bounds, the narrowest claim the data supports', () => {
    const feature = buildLinkedPlaceFeature(input({ periodFrom: null, periodTo: 400 }))

    expect(feature.when).toEqual({ timespans: [{ start: { in: '0400' }, end: { in: '0400' } }] })
  })

  it('leaves the end open when only a start is known', () => {
    const feature = buildLinkedPlaceFeature(input({ periodFrom: -50, periodTo: null }))

    expect(feature.when).toEqual({ timespans: [{ start: { in: '-0050' } }] })
  })

  it('omits ccodes rather than guessing a country', () => {
    const feature = buildLinkedPlaceFeature(input({ countryCode: null }))

    expect((feature.properties as Record<string, unknown>).ccodes).toBeUndefined()
  })

  it('maps concordances to links, defaulting to closeMatch', () => {
    const feature = buildLinkedPlaceFeature(
      input({
        identifiers: [
          { scheme: 'pleiades', url: 'https://pleiades.stoa.org/places/108921' },
          { scheme: 'wikidata', url: 'https://www.wikidata.org/wiki/Q321381' },
        ],
      }),
    )

    expect(feature.links).toEqual([
      { type: 'closeMatch', identifier: 'https://pleiades.stoa.org/places/108921' },
      { type: 'closeMatch', identifier: 'https://www.wikidata.org/wiki/Q321381' },
    ])
  })

  /** An encyclopaedia article is a document about the place, not a gazetteer record of it. */
  it('files Wikipedia as primaryTopicOf rather than a match', () => {
    const feature = buildLinkedPlaceFeature(
      input({
        identifiers: [{ scheme: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Xanten' }],
      }),
    )

    expect(feature.links).toEqual([
      { type: 'primaryTopicOf', identifier: 'https://en.wikipedia.org/wiki/Xanten' },
    ])
  })

  /**
   * Nothing here has ever established same-resource identity to `exactMatch`
   * strength — the identifiers were parsed from vici's free-text field or
   * inferred by a distance-and-category gate. Both are evidence of "the same
   * place", which is what closeMatch means.
   */
  it('never claims exactMatch, at any strength of evidence', () => {
    const feature = buildLinkedPlaceFeature(
      input({
        identifiers: [
          { scheme: 'pleiades', url: 'https://pleiades.stoa.org/places/1' },
          { scheme: 'edh', url: 'https://example.org/edh/1' },
          { scheme: 'idai-gazetteer', url: 'https://gazetteer.dainst.org/place/1' },
        ],
      }),
    )

    const relations = (feature.links as { type: string }[]).map((link) => link.type)
    expect(relations).not.toContain('exactMatch')
  })

  it('carries the licence on the description, so reuse inherits its terms', () => {
    const feature = buildLinkedPlaceFeature(input())

    expect(feature.descriptions).toEqual([
      {
        value: 'Legionary fortress on the Rhine.',
        lang: 'en',
        source: 'https://vestigian.example/site/castra-vetera',
        license: 'CC-BY-SA-3.0',
      },
    ])
  })

  it('omits descriptions when there is no summary, rather than emitting an empty one', () => {
    const feature = buildLinkedPlaceFeature(input({ summary: null }))

    expect(feature.descriptions).toBeUndefined()
  })
})

describe('featureClassesFor', () => {
  it('files a settlement as a populated place', () => {
    expect(featureClassesFor('settlement')).toEqual(['P'])
  })

  it('files everything this atlas records that is not a settlement as a site', () => {
    for (const category of [
      'fortification',
      'sanctuary',
      'burial',
      'infrastructure',
      'villa',
      'production',
      'findspot',
      'other',
    ] as const) {
      expect(featureClassesFor(category)).toEqual(['S'])
    }
  })

  it('only ever returns codes from LPF’s seven-letter vocabulary', () => {
    const allowed = new Set(['A', 'H', 'L', 'P', 'R', 'S', 'T'])
    for (const category of ['settlement', 'findspot', 'other'] as const) {
      for (const code of featureClassesFor(category)) expect(allowed.has(code)).toBe(true)
    }
  })
})

describe('linkRelationFor', () => {
  it('defaults an unrecognised scheme to closeMatch', () => {
    expect(linkRelationFor('trismegistos')).toBe('closeMatch')
  })

  it('knows Wikipedia is a document about the place', () => {
    expect(linkRelationFor('wikipedia')).toBe('primaryTopicOf')
  })
})

describe('toIsoYear', () => {
  it('pads to the four digits OWL-Time expects', () => {
    expect(toIsoYear(70)).toBe('0070')
  })

  it('keeps a negative year negative', () => {
    expect(toIsoYear(-12)).toBe('-0012')
  })

  it('leaves a four-digit year alone', () => {
    expect(toIsoYear(1250)).toBe('1250')
  })

  it('handles year zero without a sign', () => {
    expect(toIsoYear(0)).toBe('0000')
  })
})

describe('buildLinkedPlacesCollection', () => {
  it('wraps features in a FeatureCollection carrying the LPF context', () => {
    const collection = buildLinkedPlacesCollection([])

    expect(collection).toEqual({
      type: 'FeatureCollection',
      '@context': LINKED_PLACES_CONTEXT,
      features: [],
    })
  })

  it('points at the published context document, not a guessed URL', () => {
    expect(LINKED_PLACES_CONTEXT).toBe(
      'https://raw.githubusercontent.com/LinkedPasts/linked-places/master/linkedplaces-context-v1.1.jsonld',
    )
  })
})
