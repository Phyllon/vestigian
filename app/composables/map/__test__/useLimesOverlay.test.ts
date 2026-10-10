import { describe, expect, it } from 'vitest'
import type { LineLayerSpecification } from 'maplibre-gl'
import { LIMES_KIND_COLOURS, buildLimesLayers } from '../useBasemapStyle'

const layerIds = (): string[] => buildLimesLayers().map((layer) => layer.id)

const layer = (id: string): LineLayerSpecification =>
  buildLimesLayers().find((entry) => entry.id === id) as LineLayerSpecification

describe('buildLimesLayers', () => {
  it('draws one line layer per kind and precision, because line-dasharray is not data-driven', () => {
    /**
     * A `match` on the feature's kind is the obvious way to write this and
     * MapLibre accepts the style without complaint: `line-dasharray` is a
     * cross-faded property, so a data expression is ignored and every stretch
     * comes out solid — an approximate line drawn as if it were traced, with
     * nothing logged.
     */
    const ids = layerIds()
    for (const kind of ['barrier', 'river', 'notional']) {
      expect(ids).toContain(`limes-frontier-${kind}`)
      expect(ids).toContain(`limes-frontier-${kind}-approximate`)

      const dashes = layer(`limes-frontier-${kind}-approximate`).paint?.['line-dasharray']
      // Plain numbers, not an expression: `['match', ['get', 'kind'], …]` is
      // what MapLibre would silently discard.
      expect(Array.isArray(dashes) && dashes.every((step) => typeof step === 'number')).toBe(true)
    }
  })

  it('draws only traced lines solid', () => {
    for (const kind of ['barrier', 'river', 'notional']) {
      expect(layer(`limes-frontier-${kind}`).paint?.['line-dasharray']).toBeUndefined()
      expect(layer(`limes-frontier-${kind}-approximate`).paint?.['line-dasharray']).toBeDefined()
    }
  })

  it('never puts a traced line under an approximate one', () => {
    const ids = layerIds()
    const lastApproximate = Math.max(
      ...ids.map((id, index) => (id.endsWith('-approximate') ? index : -1)),
    )
    const firstTraced = Math.min(
      ...ids.map((id, index) =>
        /^limes-frontier-(barrier|river|notional)$/.test(id) ? index : Number.POSITIVE_INFINITY,
      ),
    )
    expect(lastApproximate).toBeLessThan(firstTraced)
  })

  it('tells the three kinds apart by colour, not only by dash', () => {
    // Colour is what says what the line is; if two kinds shared one, a reader
    // would have to tell a river from a wall by dash pattern alone — and the
    // dash is already spoken for (it means "approximate").
    const colours = ['barrier', 'river', 'notional'].map(
      (kind) => layer(`limes-frontier-${kind}`).paint?.['line-color'],
    )
    expect(new Set(colours).size).toBe(3)
    expect(colours).toEqual([
      LIMES_KIND_COLOURS.barrier,
      LIMES_KIND_COLOURS.river,
      LIMES_KIND_COLOURS.notional,
    ])
  })

  it('keeps every line colour readable against its paper casing', () => {
    // WCAG 1.4.11 asks 3:1 for a graphic; the casing is what the line is read
    // against on every basemap, so this is the contrast that has to hold.
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((start) => {
        const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    }
    const casing = layer('limes-frontier-casing').paint?.['line-color'] as string
    for (const colour of Object.values(LIMES_KIND_COLOURS)) {
      const [light, dark] = [luminance(casing), luminance(colour)].sort((a, b) => b - a)
      expect((light! + 0.05) / (dark! + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('puts a casing under every line', () => {
    const ids = layerIds()
    expect(ids.indexOf('limes-frontier-casing')).toBeLessThan(
      ids.indexOf('limes-frontier-notional-approximate'),
    )
  })

  it('reads the atlas source for the borrowed military places, and nothing else does', () => {
    // useLimesOverlay skips exactly this layer when the atlas source is not
    // present — i.e. on every basemap but the Barrington sheet.
    const layers = buildLimesLayers()
    const atlasLayers = layers.filter((entry) => 'source' in entry && entry.source === 'atlas')
    expect(atlasLayers.map((entry) => entry.id)).toEqual(['limes-installations'])
  })
})
