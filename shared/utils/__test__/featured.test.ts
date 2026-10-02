import { describe, expect, it } from 'vitest'
import { isFeaturable, scoreFeaturedSite, type FeaturedCandidate } from '../featured'

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
