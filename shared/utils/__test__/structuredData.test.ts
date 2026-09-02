import { describe, expect, it } from 'vitest'
import {
  buildBreadcrumbJsonLd,
  buildSiteJsonLd,
  buildTracingJsonLd,
  buildWebSiteJsonLd,
} from '../structuredData'

describe('buildSiteJsonLd', () => {
  const base = {
    title: 'Aqua Claudia',
    summary: 'A Roman aqueduct.',
    slug: 'aqua-claudia',
    position: { lat: 41.9, lon: 12.5 },
    modernPlace: null,
    countryCode: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    siteUrl: 'https://vestigian.eu',
    imageUrls: [],
  }

  it('sets the required Place fields', () => {
    const result = buildSiteJsonLd(base)
    expect(result['@type']).toBe('Place')
    expect(result.name).toBe('Aqua Claudia')
    expect(result.url).toBe('https://vestigian.eu/site/aqua-claudia')
    expect(result.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 41.9, longitude: 12.5 })
    expect(result.dateModified).toBe('2026-01-01T00:00:00.000Z')
  })

  it('omits address when neither modernPlace nor countryCode is set', () => {
    const result = buildSiteJsonLd(base)
    expect(result.address).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('"address"')
  })

  it('includes address when modernPlace or countryCode is set', () => {
    const result = buildSiteJsonLd({ ...base, modernPlace: 'Rome', countryCode: 'IT' })
    expect(result.address).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Rome',
      addressCountry: 'IT',
    })
  })

  it('omits image when there are no image URLs', () => {
    const result = buildSiteJsonLd(base)
    expect(JSON.stringify(result)).not.toContain('"image"')
  })

  it('includes image URLs when present', () => {
    const result = buildSiteJsonLd({ ...base, imageUrls: ['https://vestigian.eu/api/images/1/og'] })
    expect(result.image).toEqual(['https://vestigian.eu/api/images/1/og'])
  })

  it('leaks no stray null into the payload', () => {
    const result = buildSiteJsonLd(base)
    expect(JSON.stringify(result)).not.toContain('null')
  })
})

describe('buildTracingJsonLd', () => {
  it('builds a Place without geo', () => {
    const result = buildTracingJsonLd({
      id: 42,
      title: 'Via Appia',
      description: 'A Roman road.',
      updatedAt: '2026-01-01T00:00:00.000Z',
      siteUrl: 'https://vestigian.eu',
    })
    expect(result['@type']).toBe('Place')
    expect(result.url).toBe('https://vestigian.eu/tracing/42')
    expect(result.geo).toBeUndefined()
  })
})

describe('buildBreadcrumbJsonLd', () => {
  it('numbers items in order starting at 1', () => {
    const result = buildBreadcrumbJsonLd({
      items: [
        { name: 'Vestigian', url: 'https://vestigian.eu' },
        { name: 'Aqua Claudia', url: 'https://vestigian.eu/site/aqua-claudia' },
      ],
    })
    expect(result['@type']).toBe('BreadcrumbList')
    expect(result.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Vestigian', item: 'https://vestigian.eu' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Aqua Claudia',
        item: 'https://vestigian.eu/site/aqua-claudia',
      },
    ])
  })
})

describe('buildWebSiteJsonLd', () => {
  it('carries the site name and url', () => {
    const result = buildWebSiteJsonLd({ siteUrl: 'https://vestigian.eu', name: 'Vestigian' })
    expect(result).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Vestigian',
      url: 'https://vestigian.eu',
    })
  })
})
