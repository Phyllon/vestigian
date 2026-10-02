import { describe, expect, it } from 'vitest'
import {
  SITE_CATEGORIES,
  SITE_ICON_GLYPHS,
  SITE_MARK_CATEGORY,
  SITE_MARK_ICON_GLYPHS,
  SITE_MARK_KINDS,
  buildSiteIconExpression,
  resolveSiteMark,
  siteIconId,
  siteMarkIconId,
} from '../useSiteIcons'

describe('resolveSiteMark', () => {
  it("reads vici's seven marked subcategories", () => {
    expect(resolveSiteMark('road')).toBe('road')
    expect(resolveSiteMark('bridge')).toBe('bridge')
    expect(resolveSiteMark('milestone')).toBe('milestone')
    expect(resolveSiteMark('mansio')).toBe('mansio')
    expect(resolveSiteMark('museum')).toBe('museum')
    expect(resolveSiteMark('event')).toBe('event')
  })

  it("keeps vici's own misspelling as the lookup key for aqueduct", () => {
    // `sites.subcategory` stores vici's raw word verbatim — see
    // `CATEGORY_BY_KIND` in `scripts/import/02-mysql-to-postgres.ts` — and
    // vici spells it "aquaduct", not "aqueduct". The mark itself is spelled
    // correctly; only the lookup key matches the source's typo.
    expect(resolveSiteMark('aquaduct')).toBe('aqueduct')
    expect(resolveSiteMark('aqueduct')).toBeNull()
  })

  it('is case-insensitive and trims whitespace, the same as resolveLimesMark', () => {
    expect(resolveSiteMark('Museum')).toBe('museum')
    expect(resolveSiteMark(' milestone ')).toBe('milestone')
  })

  it('returns null for every other subcategory, including blank and missing', () => {
    expect(resolveSiteMark('city')).toBeNull()
    expect(resolveSiteMark('baths')).toBeNull()
    expect(resolveSiteMark('')).toBeNull()
    expect(resolveSiteMark(null)).toBeNull()
    expect(resolveSiteMark(undefined)).toBeNull()
  })
})

describe('SITE_MARK_CATEGORY', () => {
  it("assigns infrastructure's five marks to the infrastructure category and the rest to other", () => {
    expect(SITE_MARK_CATEGORY.road).toBe('infrastructure')
    expect(SITE_MARK_CATEGORY.bridge).toBe('infrastructure')
    expect(SITE_MARK_CATEGORY.milestone).toBe('infrastructure')
    expect(SITE_MARK_CATEGORY.aqueduct).toBe('infrastructure')
    expect(SITE_MARK_CATEGORY.mansio).toBe('infrastructure')
    expect(SITE_MARK_CATEGORY.museum).toBe('other')
    expect(SITE_MARK_CATEGORY.event).toBe('other')
  })

  it('covers every mark kind exactly once', () => {
    expect(Object.keys(SITE_MARK_CATEGORY).sort()).toEqual([...SITE_MARK_KINDS].sort())
  })
})

describe('hand-drawn glyphs', () => {
  it('villa, milestone and road are no longer the bare Lucide glyphs', () => {
    expect(SITE_ICON_GLYPHS.villa.path).not.toContain('M3 10a2 2 0 0 1 .709-1.528')
    expect(SITE_MARK_ICON_GLYPHS.milestone.path).not.toContain('M12 13v8m0-18v3m6.172')
    expect(SITE_MARK_ICON_GLYPHS.road.path).not.toContain('m-9.923 6.449')
  })

  it("museum is scaled to fit the disc, so `university`'s pediment stops overflowing it", () => {
    expect(SITE_MARK_ICON_GLYPHS.museum.inset).toBe(true)
    expect(SITE_ICON_GLYPHS.villa.inset).toBeUndefined()
  })
})

describe('buildSiteIconExpression', () => {
  it('checks subcategory before falling back to the category-based expression', () => {
    const expression = buildSiteIconExpression() as unknown[]
    expect(expression[0]).toBe('match')
    expect(expression[1]).toEqual(['get', 'subcategory'])

    // Every marked subcategory appears as a label ahead of the fallback.
    expect(expression).toContain('milestone')
    expect(expression).toContain(siteMarkIconId('milestone'))
    expect(expression).toContain('museum')
    expect(expression).toContain(siteMarkIconId('museum'))

    // vici's raw misspelling is the label, not the corrected mark name.
    expect(expression).toContain('aquaduct')
    expect(expression).not.toContain('aqueduct')
  })

  it('falls back to the original category-based match for everything else', () => {
    const expression = buildSiteIconExpression() as unknown[]
    const fallback = expression[expression.length - 1] as unknown[]
    expect(fallback[0]).toBe('match')
    expect(fallback[1]).toEqual(['get', 'category'])
    for (const category of SITE_CATEGORIES) {
      expect(fallback).toContain(category)
      expect(fallback).toContain(siteIconId(category))
    }
    expect(fallback[fallback.length - 1]).toBe(siteIconId('other'))
  })
})
