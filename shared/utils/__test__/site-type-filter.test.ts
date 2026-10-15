import { describe, expect, it } from 'vitest'
import {
  SITE_TYPE_GROUPS,
  buildSiteTypeFilter,
  buildTracingTypeFilter,
  countSelectedSubtypes,
  selectedSubtypesOf,
  setSelectedSubtypes,
} from '../site-type-filter'

describe('selectedSubtypesOf', () => {
  it('lists nothing for an empty selection', () => {
    expect(selectedSubtypesOf([], 'fortification')).toEqual([])
  })

  it('lists every kind of a category chosen whole', () => {
    expect(selectedSubtypesOf(['fortification'], 'fortification')).toEqual([
      'fort',
      'watchtower',
      'camp',
    ])
  })

  it('lists the kinds chosen one by one, in the group order', () => {
    expect(
      selectedSubtypesOf(['fortification:camp', 'fortification:fort'], 'fortification'),
    ).toEqual(['fort', 'camp'])
  })

  it('does not leak a kind into another category', () => {
    expect(selectedSubtypesOf(['fortification:fort'], 'sanctuary')).toEqual([])
  })
})

describe('setSelectedSubtypes', () => {
  it('stores kinds individually when only some are chosen', () => {
    expect(setSelectedSubtypes([], 'infrastructure', ['road', 'bridge'])).toEqual([
      'infrastructure:road',
      'infrastructure:bridge',
    ])
  })

  it('stores the category itself when every listed kind is chosen', () => {
    expect(setSelectedSubtypes([], 'sanctuary', ['temple', 'altar'])).toEqual(['sanctuary'])
  })

  it('removes the category when none are chosen, leaving the others', () => {
    expect(setSelectedSubtypes(['fortification', 'sanctuary:temple'], 'fortification', [])).toEqual(
      ['sanctuary:temple'],
    )
  })

  it('replaces a category chosen whole when a kind is taken away', () => {
    expect(setSelectedSubtypes(['sanctuary'], 'sanctuary', ['temple'])).toEqual([
      'sanctuary:temple',
    ])
  })

  it('removes a category and its single kinds together', () => {
    expect(setSelectedSubtypes(['villa', 'villa:villa', 'other:rural'], 'villa', [])).toEqual([
      'other:rural',
    ])
  })

  it('ignores a kind the group does not list', () => {
    expect(setSelectedSubtypes([], 'fortification', ['fort', 'not-a-kind'])).toEqual([
      'fortification:fort',
    ])
  })
})

describe('countSelectedSubtypes', () => {
  it('counts a whole category as every kind it lists', () => {
    expect(countSelectedSubtypes(['fortification', 'sanctuary:altar'])).toBe(4)
  })

  it('is zero for no selection', () => {
    expect(countSelectedSubtypes([])).toBe(0)
  })
})

describe('buildSiteTypeFilter', () => {
  it('is null — no filter — for an empty selection', () => {
    expect(buildSiteTypeFilter([])).toBeNull()
  })

  it('matches a whole category on its category alone', () => {
    expect(buildSiteTypeFilter(['fortification'])).toEqual([
      'match',
      ['to-string', ['get', 'category']],
      ['fortification'],
      true,
      false,
    ])
  })

  it('matches single kinds inside their own category only', () => {
    expect(buildSiteTypeFilter(['infrastructure:road', 'infrastructure:bridge'])).toEqual([
      'all',
      ['==', ['to-string', ['get', 'category']], 'infrastructure'],
      ['match', ['to-string', ['get', 'subcategory']], ['road', 'bridge'], true, false],
    ])
  })

  it('joins a whole category and single kinds with any', () => {
    const filter = buildSiteTypeFilter(['fortification', 'sanctuary:temple']) as unknown[]
    expect(filter[0]).toBe('any')
    expect(filter).toHaveLength(3)
  })

  it('drops a kind whose category is already chosen whole', () => {
    expect(buildSiteTypeFilter(['sanctuary', 'sanctuary:temple'])).toEqual(
      buildSiteTypeFilter(['sanctuary']),
    )
  })

  it('reads a missing kind as an empty string rather than a type error', () => {
    expect(JSON.stringify(buildSiteTypeFilter(['sanctuary:temple']))).toContain(
      '["to-string",["get","subcategory"]]',
    )
  })
})

describe('buildTracingTypeFilter', () => {
  it('is null for an empty selection', () => {
    expect(buildTracingTypeFilter([])).toBeNull()
  })

  it('follows every category the selection touches, whole or in part', () => {
    expect(buildTracingTypeFilter(['fortification', 'sanctuary:temple'])).toEqual([
      'match',
      ['to-string', ['get', 'category']],
      ['fortification', 'sanctuary'],
      true,
      false,
    ])
  })
})

describe('SITE_TYPE_GROUPS', () => {
  it('names each kind once, so a kind key is never ambiguous', () => {
    const subtypes = SITE_TYPE_GROUPS.flatMap((group) => group.subtypes)
    expect(new Set(subtypes).size).toBe(subtypes.length)
  })
})
