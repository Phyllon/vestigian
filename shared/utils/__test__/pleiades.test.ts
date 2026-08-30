import { describe, expect, it } from 'vitest'
import { isLocatedPrecisely, resolvePlaceCategory } from '../pleiades'

describe('resolvePlaceCategory', () => {
  it('reads the defining type, which Pleiades writes first', () => {
    // "settlement, archaeological-site" is a town that has been dug, not a
    // findspot; taking the last term would file half of Italy as findspots.
    expect(resolvePlaceCategory('settlement, archaeological-site')).toBe('settlement')
    expect(resolvePlaceCategory('archaeological-site, settlement')).toBe('findspot')
  })

  it('skips qualifiers that are not kinds of place', () => {
    expect(resolvePlaceCategory('unlocated, settlement')).toBe('settlement')
  })

  it('treats a numbered second feature as the same kind', () => {
    // Pleiades writes `temple-2` for a second attested temple at one place.
    expect(resolvePlaceCategory('temple-2')).toBe('sanctuary')
    expect(resolvePlaceCategory('fort-2')).toBe('fortification')
    expect(resolvePlaceCategory('mine-2')).toBe('production')
  })

  it('gives landscape features no mark at all', () => {
    // These belong on the sheet as names. A symbol would be the map claiming a
    // site where the source records a river.
    for (const term of ['river', 'mountain', 'cape', 'island', 'people', 'region', 'label']) {
      expect(resolvePlaceCategory(term)).toBeNull()
    }
    expect(resolvePlaceCategory(null)).toBeNull()
    expect(resolvePlaceCategory('')).toBeNull()
  })

  it('is not case- or space-sensitive, because the source is not consistent', () => {
    expect(resolvePlaceCategory('  Fort ')).toBe('fortification')
  })
})

describe('isLocatedPrecisely', () => {
  it('accepts a position and refuses a filing convenience', () => {
    // 'unlocated' has no location; 'related' borrows a neighbour's. Both carry
    // a representative point, and drawing it would assert a place on ground the
    // source says nothing about.
    expect(isLocatedPrecisely('precise')).toBe(true)
    expect(isLocatedPrecisely('rough')).toBe(true)
    expect(isLocatedPrecisely('unlocated')).toBe(false)
    expect(isLocatedPrecisely('related')).toBe(false)
    expect(isLocatedPrecisely(null)).toBe(false)
  })
})
