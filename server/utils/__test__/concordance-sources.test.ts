import { describe, expect, it } from 'vitest'
import { ringCentroid, sanitizeGazetteerQuery } from '../concordance-sources'

describe('sanitizeGazetteerQuery', () => {
  it('strips square brackets, which the search endpoint reads as range-query syntax', () => {
    expect(sanitizeGazetteerQuery('Mithraeum [Londinium]')).toBe('Mithraeum  Londinium')
  })

  it('leaves parentheses and other punctuation alone — the endpoint handles those fine', () => {
    expect(sanitizeGazetteerQuery("Milecastle 1 (Stott's Pow)")).toBe("Milecastle 1 (Stott's Pow)")
  })

  it('trims the result', () => {
    expect(sanitizeGazetteerQuery('[Bracketed]')).toBe('Bracketed')
  })
})

describe('ringCentroid', () => {
  it('averages the vertices of the first ring', () => {
    const square: [number, number][][] = [
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ],
    ]
    expect(ringCentroid(square)).toEqual({ lon: 1, lat: 1 })
  })

  it('ignores any ring after the first', () => {
    const withHole: [number, number][][] = [
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ],
      [
        [10, 10],
        [10, 12],
      ],
    ]
    expect(ringCentroid(withHole)).toEqual({ lon: 1, lat: 1 })
  })

  it('returns null for an empty or missing ring', () => {
    expect(ringCentroid([])).toBeNull()
    expect(ringCentroid([[]])).toBeNull()
  })
})
