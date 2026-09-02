import { describe, expect, it } from 'vitest'
import { buildSitemapIndexXml, buildUrlsetXml, paginateOffsets } from '../sitemap'

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
