import { describe, expect, it } from 'vitest'
import {
  COIN_HOARD_LAYER_ID,
  buildCoinHoardLayer,
  buildCoinHoardPopupHtml,
} from '../useCoinHoardOverlay'

const t = (key: string, count: number): string => {
  if (key === 'coinHoardPopup.hoardCount')
    return count === 1 ? '1 recorded hoard' : `${count} recorded hoards`
  return key
}

describe('buildCoinHoardLayer', () => {
  it('draws a single fixed icon, needing no match expression', () => {
    const layer = buildCoinHoardLayer()
    expect(layer.id).toBe(COIN_HOARD_LAYER_ID)
    expect(layer.type).toBe('symbol')
    expect(layer.layout?.['icon-image']).toBe('vestigian-coin-hoard')
  })

  it('reads the coin_hoards source layer, not atlas or limes', () => {
    const layer = buildCoinHoardLayer()
    expect(layer.source).toBe('coin-hoards')
    expect(layer['source-layer']).toBe('coin_hoards')
  })
})

describe('buildCoinHoardPopupHtml', () => {
  it('names the findspot and its hoard count', () => {
    const html = buildCoinHoardPopupHtml(
      { name: 'Abertura (Spain)', hoard_count: 1, geonames_url: null },
      t,
    )
    expect(html).toContain('Abertura (Spain)')
    expect(html).toContain('1 recorded hoard')
  })

  it('escapes a findspot name before it reaches setHTML', () => {
    const html = buildCoinHoardPopupHtml(
      { name: '<script>alert(1)</script>', hoard_count: 2, geonames_url: null },
      t,
    )
    expect(html).not.toContain('<script>')
  })
})
