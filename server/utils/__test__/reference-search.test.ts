import { describe, expect, it } from 'vitest'
import { REFERENCE_SEARCH_SOURCES, tokeniseSearchTerm } from '../reference-search'

describe('tokeniseSearchTerm', () => {
  it('treats commas and brackets as spaces, so a name carrying them is still found', () => {
    expect(tokeniseSearchTerm('Dun Mor, Angus (Acharn)')).toEqual(['dun', 'mor', 'angus', 'acharn'])
  })

  it('reads the same words with or without the comma', () => {
    expect(tokeniseSearchTerm('dun mor angus')).toEqual(tokeniseSearchTerm('Dun Mor, Angus'))
  })

  it('keeps non-latin letters and digits, which are safe in a pattern', () => {
    expect(tokeniseSearchTerm('Θεσσαλονίκη II')).toEqual(['θεσσαλονίκη', 'ii'])
  })

  it('returns nothing for a term of pure punctuation', () => {
    expect(tokeniseSearchTerm('%_ ,,')).toEqual([])
  })

  it('caps the word count so a pasted paragraph cannot build a huge query', () => {
    expect(tokeniseSearchTerm('a b c d e f g h')).toHaveLength(6)
  })
})

describe('REFERENCE_SEARCH_SOURCES', () => {
  it('names each layer once', () => {
    const layers = REFERENCE_SEARCH_SOURCES.map((source) => source.layer)
    expect(new Set(layers).size).toBe(layers.length)
  })
})
