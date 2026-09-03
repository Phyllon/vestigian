import { describe, expect, it } from 'vitest'
import type { LineLayerSpecification } from 'maplibre-gl'
import { buildLimesLayers } from '../useBasemapStyle'

const layerIds = (): string[] => buildLimesLayers().map((layer) => layer.id)

const layer = (id: string): LineLayerSpecification =>
  buildLimesLayers().find((entry) => entry.id === id) as LineLayerSpecification

describe('buildLimesLayers', () => {
  it('draws one line layer per kind, because line-dasharray is not data-driven', () => {
    /**
     * A `match` on the feature's kind is the obvious way to write this and
     * MapLibre accepts the style without complaint: `line-dasharray` is a
     * cross-faded property, so a data expression is ignored and every stretch
     * comes out solid — a river drawn as a wall, with nothing logged.
     */
    const ids = layerIds()
    expect(ids).toContain('limes-frontier-barrier')
    expect(ids).toContain('limes-frontier-river')
    expect(ids).toContain('limes-frontier-notional')

    for (const id of ['limes-frontier-river', 'limes-frontier-notional']) {
      const dashes = layer(id).paint?.['line-dasharray']
      // Plain numbers, not an expression: `['match', ['get', 'kind'], …]` is
      // what MapLibre would silently discard.
      expect(Array.isArray(dashes) && dashes.every((step) => typeof step === 'number')).toBe(true)
    }
  })

  it('draws only the built works solid', () => {
    expect(layer('limes-frontier-barrier').paint?.['line-dasharray']).toBeUndefined()
    expect(layer('limes-frontier-river').paint?.['line-dasharray']).toBeDefined()
    expect(layer('limes-frontier-notional').paint?.['line-dasharray']).toBeDefined()
  })

  it('spends the one accent on the frontier and puts a casing under it', () => {
    // The house rule is one oxide red per screen, never decorative. Here it is
    // the subject. The casing is what keeps the line readable where it runs
    // along the supply road that served it.
    const ids = layerIds()
    expect(ids.indexOf('limes-frontier-casing')).toBeLessThan(ids.indexOf('limes-frontier-barrier'))
    expect(layer('limes-frontier-barrier').paint?.['line-color']).toBe('#9a3b22')
  })

  it('reads the atlas source for the borrowed military places, and nothing else does', () => {
    // useLimesOverlay skips exactly this layer when the atlas source is not
    // present — i.e. on every basemap but the Barrington sheet.
    const layers = buildLimesLayers()
    const atlasLayers = layers.filter((entry) => 'source' in entry && entry.source === 'atlas')
    expect(atlasLayers.map((entry) => entry.id)).toEqual(['limes-installations'])
  })
})
