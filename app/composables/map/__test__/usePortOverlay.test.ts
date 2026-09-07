import { describe, expect, it } from 'vitest'
import { PORT_LAYER_ID, buildPortLayer, buildPortPopupHtml } from '../usePortOverlay'

const t = (key: string): string => {
  if (key === 'portPopup.viewOnPleiades') return 'View on Pleiades'
  if (key === 'portPopup.viewOnWikipedia') return 'View on Wikipedia'
  return key
}

describe('buildPortLayer', () => {
  it('draws a single fixed icon, needing no match expression', () => {
    const layer = buildPortLayer()
    expect(layer.id).toBe(PORT_LAYER_ID)
    expect(layer.type).toBe('symbol')
    expect(layer.layout?.['icon-image']).toBe('vestigian-port')
  })

  it('reads the ports source layer, not atlas or limes', () => {
    const layer = buildPortLayer()
    expect(layer.source).toBe('ports')
    expect(layer['source-layer']).toBe('ports')
  })
})

describe('buildPortPopupHtml', () => {
  it('names the port and shows its country and foundation when present', () => {
    const html = buildPortPopupHtml(
      {
        title: 'Ostia',
        modern_name: null,
        country: 'Italy',
        foundation: '-620',
        pleiades_url: null,
        wikipedia_url: null,
      },
      t,
    )
    expect(html).toContain('Ostia')
    expect(html).toContain('Italy')
    expect(html).toContain('-620')
  })

  it('omits blank fields rather than printing empty lines', () => {
    const html = buildPortPopupHtml(
      {
        title: 'Unnamed port',
        modern_name: null,
        country: null,
        foundation: null,
        pleiades_url: null,
        wikipedia_url: null,
      },
      t,
    )
    expect(html).toBe('<strong>Unnamed port</strong>')
  })

  it('links to Pleiades and Wikipedia only when they exist', () => {
    const html = buildPortPopupHtml(
      {
        title: 'Piraeus',
        modern_name: null,
        country: null,
        foundation: null,
        pleiades_url: 'https://pleiades.stoa.org/places/579885',
        wikipedia_url: 'https://en.wikipedia.org/wiki/Piraeus',
      },
      t,
    )
    expect(html).toContain('href="https://pleiades.stoa.org/places/579885"')
    expect(html).toContain('View on Pleiades')
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Piraeus"')
    expect(html).toContain('View on Wikipedia')
  })

  it('escapes a title before it reaches setHTML, unlike a Vue template', () => {
    const html = buildPortPopupHtml(
      {
        title: '<script>alert(1)</script>',
        modern_name: null,
        country: null,
        foundation: null,
        pleiades_url: null,
        wikipedia_url: null,
      },
      t,
    )
    expect(html).not.toContain('<script>')
  })
})
