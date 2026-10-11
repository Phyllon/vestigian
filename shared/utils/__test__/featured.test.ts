import { describe, expect, it } from 'vitest'
import {
  excerptSummary,
  isFeaturable,
  scoreFeaturedSite,
  type FeaturedCandidate,
} from '../featured'

const complete: FeaturedCandidate = {
  approvedImageCount: 1,
  endorsementCount: 0,
  hasDescription: true,
  hasPeriod: true,
  hasSummary: true,
}

describe('isFeaturable', () => {
  it('needs both a photograph and a description', () => {
    expect(isFeaturable(complete)).toBe(true)
    expect(isFeaturable({ ...complete, approvedImageCount: 0 })).toBe(false)
    expect(isFeaturable({ ...complete, hasDescription: false })).toBe(false)
  })
})

describe('scoreFeaturedSite', () => {
  it('ranks a fuller record above a thinner one', () => {
    const thin = scoreFeaturedSite({ ...complete, hasPeriod: false, hasSummary: false })
    expect(scoreFeaturedSite(complete)).toBeGreaterThan(thin)
  })

  it('rewards photographs and endorsements', () => {
    const base = scoreFeaturedSite(complete)
    expect(scoreFeaturedSite({ ...complete, approvedImageCount: 3 })).toBeGreaterThan(base)
    expect(scoreFeaturedSite({ ...complete, endorsementCount: 4 })).toBeGreaterThan(base)
  })

  it('caps the bonuses so one site cannot dominate forever', () => {
    expect(scoreFeaturedSite({ ...complete, approvedImageCount: 50 })).toBe(
      scoreFeaturedSite({ ...complete, approvedImageCount: 5 }),
    )
    expect(scoreFeaturedSite({ ...complete, endorsementCount: 500 })).toBe(
      scoreFeaturedSite({ ...complete, endorsementCount: 10 }),
    )
  })
})

describe('excerptSummary', () => {
  it('returns nothing for an absent or blank summary', () => {
    expect(excerptSummary(null, 100)).toBeNull()
    expect(excerptSummary(undefined, 100)).toBeNull()
    expect(excerptSummary('  \n\t ', 100)).toBeNull()
  })

  it('leaves a short summary whole, with its whitespace tidied', () => {
    expect(excerptSummary('A  Roman\nfort.', 100)).toBe('A Roman fort.')
  })

  it('cuts at a word and stays within the budget, ellipsis included', () => {
    const cut = excerptSummary('The legionary fortress guarded the crossing of the river', 30)
    expect(cut).toBe('The legionary fortress…')
    expect(cut!.length).toBeLessThanOrEqual(30)
  })

  it('does not leave punctuation hanging before the ellipsis', () => {
    expect(excerptSummary('Baths, a forum, and a theatre stood here', 15)).toBe('Baths, a…')
  })

  it('cuts inside a word only when there is no boundary to cut at', () => {
    expect(excerptSummary('Pseudopseudohypoparathyroidism', 10)).toBe('Pseudopse…')
  })

  it('keeps a summary exactly at the limit whole', () => {
    expect(excerptSummary('abcde fghij', 11)).toBe('abcde fghij')
  })
})
