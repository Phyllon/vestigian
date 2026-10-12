import { describe, expect, it } from 'vitest'
import {
  buildSitemapIndexXml,
  buildUrlsetXml,
  paginateOffsets,
  SITEMAP_PAGE_SIZE,
  SITEMAP_PROTOCOL_MAX_ENTRIES,
  sitemapPageCount,
} from '../sitemap'

describe('paginateOffsets', () => {
  it('returns a single zero offset when there are no rows', () => {
    expect(paginateOffsets(0, 100)).toEqual([0])
  })

  it('returns a single page when the count fits exactly', () => {
    expect(paginateOffsets(100, 100)).toEqual([0])
  })

  it('adds a remainder page for a partial last page', () => {
    expect(paginateOffsets(101, 100)).toEqual([0, 100])
  })

  it('covers several full pages plus a remainder', () => {
    expect(paginateOffsets(250, 100)).toEqual([0, 100, 200])
  })
})

describe('buildUrlsetXml', () => {
  it('escapes reserved XML characters in loc', () => {
    const xml = buildUrlsetXml([{ loc: 'https://vestigian.eu/site/aqua-&-claudia' }])
    expect(xml).toContain('aqua-&amp;-claudia')
    expect(xml).not.toContain('aqua-&-claudia')
  })

  it('includes lastmod only when provided', () => {
    const xml = buildUrlsetXml([
      { loc: 'https://vestigian.eu/site/a', lastmod: '2026-01-01' },
      { loc: 'https://vestigian.eu/site/b' },
    ])
    expect(xml).toContain(
      '<url><loc>https://vestigian.eu/site/a</loc><lastmod>2026-01-01</lastmod></url>',
    )
    expect(xml).toContain('<url><loc>https://vestigian.eu/site/b</loc></url>')
  })

  it('produces a valid urlset root element', () => {
    const xml = buildUrlsetXml([])
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('</urlset>')
  })
})

describe('buildSitemapIndexXml', () => {
  it('lists every child sitemap', () => {
    const xml = buildSitemapIndexXml([
      'https://vestigian.eu/sitemap-sites-0.xml',
      'https://vestigian.eu/sitemap-tracings-0.xml',
    ])
    expect(xml).toContain('<sitemap><loc>https://vestigian.eu/sitemap-sites-0.xml</loc></sitemap>')
    expect(xml).toContain(
      '<sitemap><loc>https://vestigian.eu/sitemap-tracings-0.xml</loc></sitemap>',
    )
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
  })
})

describe('the protocol limits', () => {
  it('keeps a page inside what a file may hold, with room to spare', () => {
    expect(SITEMAP_PAGE_SIZE).toBeLessThan(SITEMAP_PROTOCOL_MAX_ENTRIES)
  })

  it('refuses to write a file a crawler would reject whole', () => {
    const tooMany = Array.from({ length: SITEMAP_PROTOCOL_MAX_ENTRIES + 1 }, (_, index) => ({
      loc: `https://vestigian.org/site/${index}`,
    }))
    expect(() => buildUrlsetXml(tooMany)).toThrow(/at most 50000/)
    expect(() => buildUrlsetXml(tooMany.slice(0, SITEMAP_PROTOCOL_MAX_ENTRIES))).not.toThrow()
  })

  it('refuses an index of more than 50,000 sitemaps', () => {
    const children = Array.from(
      { length: SITEMAP_PROTOCOL_MAX_ENTRIES + 1 },
      (_, index) => `https://vestigian.org/sitemap-sites/${index}`,
    )
    expect(() => buildSitemapIndexXml(children)).toThrow(/at most 50000/)
  })
})

describe('sitemapPageCount', () => {
  it('is at least one page, even over nothing', () => {
    expect(sitemapPageCount(0)).toBe(1)
  })

  it('adds a page exactly when a file is full', () => {
    expect(sitemapPageCount(SITEMAP_PAGE_SIZE)).toBe(1)
    expect(sitemapPageCount(SITEMAP_PAGE_SIZE + 1)).toBe(2)
  })

  it('agrees with paginateOffsets', () => {
    for (const total of [0, 1, 39_999, 40_000, 40_001, 160_000, 160_001]) {
      expect(sitemapPageCount(total)).toBe(paginateOffsets(total, SITEMAP_PAGE_SIZE).length)
    }
  })
})
