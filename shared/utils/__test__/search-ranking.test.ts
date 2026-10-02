import { describe, expect, it } from 'vitest'
import type { MapSearchResult } from '#shared/types'
import { rankSearchResults } from '../search-ranking'

const position = { lon: 0, lat: 0 }

const place = (name: string, relevance: number): MapSearchResult => ({
  kind: 'place',
  id: 1,
  name,
  countryCode: 'GB',
  position,
  relevance,
})

const ancient = (title: string, relevance: number): MapSearchResult => ({
  kind: 'ancient-place',
  id: 2,
  title,
  category: null,
  position,
  relevance,
})

const label = (result: MapSearchResult): string =>
  result.kind === 'place' ? result.name : result.title

describe('rankSearchResults', () => {
  it('puts the best match first whichever source it came from', () => {
    const ranked = rankSearchResults([place('Vite', 0.375), ancient('Vitudurum', 1)])
    expect(ranked.map(label)).toEqual(['Vitudurum'])
  })

  it('drops trigram-only results once a name match exists', () => {
    const ranked = rankSearchResults([
      place('Vite', 0.375),
      ancient('Vitsa', 0.33),
      ancient('Vitudurum', 1),
      place('Colonia Vitudurum', 0.9),
    ])
    expect(ranked.map(label)).toEqual(['Vitudurum', 'Colonia Vitudurum'])
  })

  it('keeps fuzzy results, best first, when nothing matches by name', () => {
    const ranked = rankSearchResults([place('Londa', 0.5), ancient('Londinium', 0.7)])
    expect(ranked.map(label)).toEqual(['Londinium', 'Londa'])
  })

  it('keeps arrival order between equal scores', () => {
    const ranked = rankSearchResults([
      place('London', 1),
      place('Londrina', 1),
      ancient('Londinium', 1),
    ])
    expect(ranked.map(label)).toEqual(['London', 'Londrina', 'Londinium'])
  })

  it('treats a missing relevance as no match', () => {
    const unscored: MapSearchResult = { ...place('Rome', 0), relevance: undefined }
    expect(rankSearchResults([unscored, ancient('Roma', 1)]).map(label)).toEqual(['Roma'])
  })
})
