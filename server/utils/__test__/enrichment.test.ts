import { describe, expect, it } from 'vitest'
import {
  ENRICHMENT_MATCH_METRES,
  checkPlaceType,
  metresBetween,
  normaliseWikidataId,
  verifyEnrichmentMatch,
} from '../enrichment'

describe('normaliseWikidataId', () => {
  it('passes a well-formed id through', () => {
    expect(normaliseWikidataId('Q474982')).toBe('Q474982')
  })

  /**
   * The two shapes vici's free-text `pmeta_extids` actually produced, across
   * 97 of 3,495 rows. Both are unambiguous, so both are repaired.
   */
  it('repairs the malformed ids the import left behind', () => {
    expect(normaliseWikidataId('q10365480')).toBe('Q10365480')
    expect(normaliseWikidataId('Q2859241)')).toBe('Q2859241')
    expect(normaliseWikidataId('  Q123  ')).toBe('Q123')
  })

  it('refuses anything it cannot be certain of', () => {
    for (const value of [
      '',
      'P474982',
      'Q',
      'Q12A',
      'wikidata=Q1',
      'https://…/Q1',
      null,
      undefined,
    ])
      expect(normaliseWikidataId(value)).toBeNull()
  })
})

describe('metresBetween', () => {
  it('is zero for a point against itself', () => {
    expect(metresBetween({ lon: 6.649, lat: 49.748 }, { lon: 6.649, lat: 49.748 })).toBe(0)
  })

  /**
   * The Trier amphitheatre as the two projects record it: ours at
   * 49.74802/6.649105, Wikidata's P625 at 49.7481/6.64889. Measured at roughly
   * 16 m, which is the kind of agreement a real match produces.
   */
  it('measures a real pair of records for the same place', () => {
    const distance = metresBetween({ lon: 6.649105, lat: 49.74802 }, { lon: 6.64889, lat: 49.7481 })
    expect(distance).toBeGreaterThan(5)
    expect(distance).toBeLessThan(40)
  })

  it('measures a degree of latitude at roughly 111 km', () => {
    const distance = metresBetween({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })
    expect(distance).toBeGreaterThan(110000)
    expect(distance).toBeLessThan(112000)
  })
})

describe('checkPlaceType', () => {
  it('agrees when the vocabularies line up', () => {
    expect(checkPlaceType({ category: 'settlement', placeTypes: ['settlement'] })).toBe(
      'compatible',
    )
    expect(checkPlaceType({ category: 'production', placeTypes: ['quarry'] })).toBe('compatible')
  })

  it('agrees when any one of several types matches', () => {
    expect(
      checkPlaceType({ category: 'sanctuary', placeTypes: ['sanctuary', 'theatre', 'plaza'] }),
    ).toBe('compatible')
  })

  it('contradicts when the source describes a different kind of thing', () => {
    expect(checkPlaceType({ category: 'fortification', placeTypes: ['settlement'] })).toBe(
      'incompatible',
    )
  })

  /**
   * Silence is not disagreement. An unmapped vocabulary must not be able to
   * veto a match, or every unfamiliar term becomes a false rejection.
   */
  it('withholds judgement rather than objecting', () => {
    expect(checkPlaceType({ category: 'villa', placeTypes: [] })).toBe('unknown')
    expect(checkPlaceType({ category: 'villa', placeTypes: ['unheard-of-thing'] })).toBe('unknown')
  })

  it('never contradicts on our own unclassified bucket', () => {
    expect(checkPlaceType({ category: 'other', placeTypes: ['settlement'] })).toBe('unknown')
  })
})

describe('verifyEnrichmentMatch', () => {
  const site = { position: { lon: 6.649105, lat: 49.74802 }, category: 'other' as const }

  const at = (metresEast: number) => ({
    // ~1 degree of longitude is 111.32 km * cos(lat); enough for a test fixture.
    lon: site.position.lon + metresEast / (111320 * Math.cos((site.position.lat * Math.PI) / 180)),
    lat: site.position.lat,
  })

  it('accepts a candidate that agrees on position', () => {
    const verdict = verifyEnrichmentMatch({
      site,
      candidate: { position: at(53), placeTypes: [] },
    })
    expect(verdict.accepted).toBe(true)
    expect(verdict.reason).toBeNull()
    expect(verdict.distanceMetres).toBeLessThan(ENRICHMENT_MATCH_METRES)
  })

  /** The p90 of the sample — a concordance pointing at the wrong place. */
  it('rejects the kilometre-scale disagreements', () => {
    const verdict = verifyEnrichmentMatch({
      site,
      candidate: { position: at(1050), placeTypes: [] },
    })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe('too-far')
  })

  it('rejects a candidate that carries no coordinate to check', () => {
    const verdict = verifyEnrichmentMatch({ site, candidate: { position: null, placeTypes: [] } })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe('no-coordinate')
  })

  /**
   * The failure distance alone cannot catch: the modern town that grew over
   * the site sits well inside 250 m, and only the type disagrees.
   */
  it('rejects the right position described as the wrong kind of place', () => {
    const verdict = verifyEnrichmentMatch({
      site: { ...site, category: 'fortification' },
      candidate: { position: at(40), placeTypes: ['settlement'] },
    })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe('wrong-kind-of-place')
  })

  it('reports the distance even when it refuses', () => {
    const verdict = verifyEnrichmentMatch({
      site,
      candidate: { position: at(5000), placeTypes: [] },
    })
    expect(verdict.distanceMetres).toBeGreaterThan(4000)
  })
})
