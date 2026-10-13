import { describe, expect, it } from 'vitest'
import {
  MARKER_ICON_SIZE,
  MARKER_ICON_SIZE_STOPS,
  SITE_CATEGORIES,
  SITE_ICON_GLYPHS,
  SITE_MARK_CATEGORY,
  SITE_MARK_ICON_GLYPHS,
  SITE_MARK_KINDS,
  buildSiteIconExpression,
  markerDiscPixelsAt,
  markerIconSizeAt,
  resolveSiteMark,
  scaleMarkerIconSize,
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

describe('the marker size curve', () => {
  it('is the one MapLibre expression and the one function, from the same stops', () => {
    const [, , , ...flatStops] = MARKER_ICON_SIZE as unknown as unknown[]
    expect(flatStops).toEqual(MARKER_ICON_SIZE_STOPS.flat())
  })

  it('reads the stop values exactly and clamps outside them', () => {
    MARKER_ICON_SIZE_STOPS.forEach(([zoom, size]) => {
      expect(markerIconSizeAt(zoom)).toBeCloseTo(size)
    })
    expect(markerIconSizeAt(0)).toBe(MARKER_ICON_SIZE_STOPS[0]![1])
    expect(markerIconSizeAt(22)).toBe(1)
  })

  it('interpolates linearly between stops, as the expression does', () => {
    // Halfway between zoom 9 (0.62) and 13 (0.85).
    expect(markerIconSizeAt(11)).toBeCloseTo((0.62 + 0.85) / 2)
  })

  it('puts the per-feature factor inside every stop, with zoom still the top-level input', () => {
    const scaled = scaleMarkerIconSize(['get', 'scale']) as unknown as unknown[]
    expect(scaled.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']])
    expect(scaled.slice(3)).toEqual(
      MARKER_ICON_SIZE_STOPS.flatMap(([zoom, size]) => [zoom, ['*', ['get', 'scale'], size]]),
    )
  })

  it('measures the disc a marker draws, not the image around it', () => {
    // 46px image, disc 20.8 of its 24 units wide, at the zoom-17 stop of 1.
    expect(markerDiscPixelsAt(17)).toBeCloseTo(46 * (20.8 / 24))
    expect(markerDiscPixelsAt(9)).toBeCloseTo(46 * (20.8 / 24) * 0.62)
  })
})
