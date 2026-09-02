import { describe, expect, it } from 'vitest'
import type {
  LineLayerSpecification,
  RasterDEMSourceSpecification,
  SymbolLayerSpecification,
  RasterSourceSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'
import type { BasemapSource } from '#shared/types'
import {
  BASEMAP_VIEWS,
  MAP_LABEL_FONT,
  buildBasemapStyle,
  isAntiquityView,
  resolveSheetTone,
} from '../useBasemapStyle'

const source: BasemapSource = {
  provider: 'openfreemap',
  pmtilesUrl: '',
  terrainUrl: 'https://elevation.example/{z}/{x}/{y}.png',
  antiquityDareUrl: '',
  atlasTilesUrl: 'http://localhost:3000/api/tiles/antiquity',
  limesTilesUrl: 'http://localhost:3000/api/tiles/limes',
  glyphsUrl: '/fonts/{fontstack}/{range}.pbf',
}

const dareSource = (overrides: Partial<BasemapSource> = {}) => {
  const style = buildBasemapStyle({
    view: 'antiquity-dare',
    isDark: false,
    source: { ...source, ...overrides },
  })
  return style.sources.antiquity as RasterSourceSpecification
}

const atlasStyle = (overrides: Partial<BasemapSource> = {}) =>
  buildBasemapStyle({ view: 'antiquity-awmc', isDark: false, source: { ...source, ...overrides } })

const limesStyle = () =>
  buildBasemapStyle({
    view: 'antiquity-awmc',
    isDark: false,
    source,
    isFollowingLimes: true,
  })

const layerIds = (style: ReturnType<typeof buildBasemapStyle>): string[] =>
  style.layers.map((layer) => layer.id)

describe('buildBasemapStyle, antiquity views', () => {
  it('drops the modern vector source entirely', () => {
    // The point of these views is not that the modern layers are hidden but
    // that they are never requested; a lingering vector source would keep
    // talking to the tile host on every pan.
    expect(dareSource()).toBeDefined()
    for (const view of ['antiquity-dare', 'antiquity-awmc'] as const) {
      expect(buildBasemapStyle({ view, isDark: false, source }).sources.basemap).toBeUndefined()
    }
  })

  it('carries the attribution each licence requires, with a link', () => {
    // CC BY-SA 3.0 for DARE, and ODbL 1.0 plus CC BY 3.0 for the data behind
    // the Barrington sheet. All three make this a condition of use rather than
    // a courtesy, and the attribution control is where it shows.
    const dare = dareSource().attribution ?? ''
    expect(dare).toContain('<a href=')
    expect(dare).toContain('CC BY-SA 3.0')

    const atlas = (atlasStyle().sources.atlas as VectorSourceSpecification).attribution ?? ''
    expect(atlas).toContain('Ancient World Mapping Center')
    expect(atlas).toContain('ODbL')
    expect(atlas).toContain('Pleiades')
  })

  it('stops DARE at the zoom the mirror actually holds', () => {
    // Above this MapLibre overzooms. Without the ceiling it requests tiles the
    // source does not publish and the base goes blank exactly where sites
    // become individual markers.
    expect(dareSource().maxzoom).toBe(10)
  })

  it('prefers the DARE mirror over the university server when one is configured', () => {
    const mirrored = dareSource({
      antiquityDareUrl: 'https://cdn.example/basemap/dare/{z}/{x}/{y}.png',
    })
    expect(mirrored.tiles).toEqual(['https://cdn.example/basemap/dare/{z}/{x}/{y}.png'])
    expect(dareSource().tiles?.[0]).toContain('dh.gu.se')
  })

  it('draws the Barrington sheet from this application', () => {
    const atlas = atlasStyle().sources.atlas as VectorSourceSpecification
    expect(atlas.type).toBe('vector')
    // Absolute, because MapLibre builds tile requests in a worker where a
    // root-relative path has no base and `new Request` throws.
    expect(atlas.tiles?.[0]).toMatch(/^https?:\/\/.+\/api\/tiles\/antiquity\/\{z\}/)
  })

  it('distinguishes a road whose course is inferred from one that is established', () => {
    // Barrington records the difference and the map has no business flattening
    // it: a solid line for both would assert more than the source does.
    const dashed = atlasStyle().layers.find((layer) => layer.id === 'atlas-roads-inferred')
    expect(dashed?.type).toBe('line')
    expect((dashed as LineLayerSpecification).paint?.['line-dasharray']).toBeDefined()
  })

  it('keeps glyphs, which the labels cannot render without', () => {
    expect(atlasStyle().glyphs).toBe('/fonts/{fontstack}/{range}.pbf')
    expect(dareSource()).toBeDefined()
  })
})

describe('buildBasemapStyle, vector views', () => {
  it('asks for the fontstack the repository actually ships', () => {
    // The directory under public/fonts is named for this string. A mismatch
    // renders every label blank and logs nothing worth reading.
    const style = buildBasemapStyle({ view: 'modern', isDark: false, source })
    const labels = style.layers.find((layer) => layer.id === 'place-labels')
    expect(labels?.type === 'symbol' && labels.layout?.['text-font']).toEqual([MAP_LABEL_FONT])
  })

  it('serves glyphs from this origin rather than a font server', () => {
    const style = buildBasemapStyle({ view: 'vestigian', isDark: false, source })
    expect(style.glyphs).not.toMatch(/^https?:/)
  })
})

describe('isAntiquityView', () => {
  it('is true for exactly the raster sheets', () => {
    const antiquity = BASEMAP_VIEWS.filter((option) => option.group === 'antiquity')
    expect(antiquity.map((option) => option.value).every(isAntiquityView)).toBe(true)
    expect(
      BASEMAP_VIEWS.filter((option) => option.group === 'today').some((option) =>
        isAntiquityView(option.value),
      ),
    ).toBe(false)
  })
})

describe('resolveSheetTone', () => {
  it('keeps the sheet light over an antiquity raster even at night', () => {
    // The failure this guards is silent: the night overlay palette is pale ink
    // on a dark disc, and drawn on parchment every site marker disappears.
    expect(resolveSheetTone('antiquity-dare', true)).toBe('light')
    expect(resolveSheetTone('antiquity-awmc', true)).toBe('light')
  })

  it('follows the theme everywhere else', () => {
    expect(resolveSheetTone('modern', true)).toBe('dark')
    expect(resolveSheetTone('modern', false)).toBe('light')
  })
})

describe('the frontier', () => {
  it('leaves the Barrington sheet exactly as it was when the switch is off', () => {
    /**
     * The regression that matters most. The frontier is an option on the atlas
     * style rather than a style of its own, which is what keeps a hundred lines
     * of layer specs from being copied and drifting — and the price of that
     * choice is that a change made for the frontier can reach a reader who
     * never asked for it. This is the assertion that says it cannot.
     */
    const off = atlasStyle()
    expect(layerIds(off).some((id) => id.startsWith('limes-'))).toBe(false)
    expect(off.sources.limes).toBeUndefined()
    expect(layerIds(off)).toEqual([
      'background',
      'atlas-hillshade',
      'atlas-sea',
      'atlas-inland-water',
      'atlas-urban',
      'atlas-coast',
      'atlas-infrastructure',
      'atlas-roads-inferred',
      'atlas-roads',
      'atlas-places',
      'atlas-region-labels',
    ])
  })

  it('adds the frontier from this application, not a third party', () => {
    const limes = limesStyle().sources.limes as VectorSourceSpecification
    expect(limes.type).toBe('vector')
    expect(limes.tiles?.[0]).toMatch(/^http:\/\/localhost:3000\/api\/tiles\/limes\/\{z\}/)
  })

  it('says the frontier is derived rather than surveyed', () => {
    // It is the boundary of AWMC's extent of the empire with the coast taken
    // out of it, not a dataset anyone published. A reader is owed that before
    // they cite it.
    const attribution = (limesStyle().sources.atlas as VectorSourceSpecification).attribution ?? ''
    expect(attribution).toContain('Ancient World Mapping Center')
    expect(attribution).toContain('derived')
  })

  it('draws one line layer per kind, because line-dasharray is not data-driven', () => {
    /**
     * A `match` on the feature's kind is the obvious way to write this and
     * MapLibre accepts the style without complaint: `line-dasharray` is a
     * cross-faded property, so a data expression is ignored and every stretch
     * comes out solid — a river drawn as a wall, with nothing logged.
     */
    const ids = layerIds(limesStyle())
    expect(ids).toContain('limes-frontier-barrier')
    expect(ids).toContain('limes-frontier-river')
    expect(ids).toContain('limes-frontier-notional')

    for (const id of ['limes-frontier-river', 'limes-frontier-notional']) {
      const layer = limesStyle().layers.find((entry) => entry.id === id) as LineLayerSpecification
      const dashes = layer.paint?.['line-dasharray']
      // Plain numbers, not an expression: `['match', ['get', 'kind'], …]` is
      // what MapLibre would silently discard.
      expect(Array.isArray(dashes) && dashes.every((step) => typeof step === 'number')).toBe(true)
    }
  })

  it('draws only the built works solid', () => {
    const layer = (id: string) =>
      limesStyle().layers.find((entry) => entry.id === id) as LineLayerSpecification

    expect(layer('limes-frontier-barrier').paint?.['line-dasharray']).toBeUndefined()
    expect(layer('limes-frontier-river').paint?.['line-dasharray']).toBeDefined()
    expect(layer('limes-frontier-notional').paint?.['line-dasharray']).toBeDefined()
  })

  it('spends the one accent on the frontier and puts a casing under it', () => {
    // The house rule is one oxide red per screen, never decorative. Here it is
    // the subject. The casing is what keeps the line readable where it runs
    // along the supply road that served it.
    const ids = layerIds(limesStyle())
    expect(ids.indexOf('limes-frontier-casing')).toBeLessThan(ids.indexOf('limes-frontier-barrier'))

    const barrier = limesStyle().layers.find(
      (entry) => entry.id === 'limes-frontier-barrier',
    ) as LineLayerSpecification
    expect(barrier.paint?.['line-color']).toBe('#9a3b22')
  })

  it('pushes the rest of the sheet back so the frontier can be the subject', () => {
    const roads = (style: ReturnType<typeof buildBasemapStyle>) =>
      style.layers.find((entry) => entry.id === 'atlas-roads') as LineLayerSpecification

    expect(roads(atlasStyle()).paint?.['line-opacity']).toBe(1)
    expect(roads(limesStyle()).paint?.['line-opacity']).toBeLessThan(1)
  })

  it('stops the general place layer drawing what the frontier layer draws', () => {
    // Both read the same `places` source layer. Without the exclusion every
    // tower on the wall carries a crenellation and a plan stacked on one point.
    const places = (style: ReturnType<typeof buildBasemapStyle>) =>
      style.layers.find((entry) => entry.id === 'atlas-places') as SymbolLayerSpecification

    expect(places(limesStyle()).filter).toBeDefined()
    expect(JSON.stringify(places(limesStyle()).filter)).toContain('military')
    expect(places(atlasStyle()).filter).toBeUndefined()
  })

  it('is not offered on a sheet it would mislead on', () => {
    // The flag is ignored anywhere but the Barrington sheet, so a frontier can
    // never be drawn against present-day motorways.
    for (const view of ['vestigian', 'modern', 'antiquity-dare'] as const) {
      const style = buildBasemapStyle({ view, isDark: false, source, isFollowingLimes: true })
      expect(layerIds(style).some((id) => id.startsWith('limes-'))).toBe(false)
    }
  })
})

describe('the views on offer', () => {
  it('no longer offers terrain', () => {
    /**
     * It was the `vestigian` palette with one hillshade layer spliced in, and
     * the same elevation source does better work as `atlas-hillshade` under the
     * Barrington sheet — so the relief is still on the map and the option was
     * only a fourth way to look at the same roads.
     */
    expect(BASEMAP_VIEWS.map((option) => option.value)).not.toContain('terrain')
    expect(BASEMAP_VIEWS).toHaveLength(4)
  })

  it('still keeps the elevation source, which the atlas sheet needs', () => {
    // Deleting the view must not delete the tiles: `atlas-hillshade` reads the
    // same `terrainUrl`.
    expect(atlasStyle().sources.terrain).toBeDefined()
  })

  it('falls back to a working elevation host when the variable is set to nothing', () => {
    // An env file that copies `.env.example` and leaves the line blank would
    // otherwise request tiles from '' — a flat sheet, and nothing logged.
    const blank = atlasStyle({ terrainUrl: '' }).sources.terrain as RasterDEMSourceSpecification
    expect(blank.tiles?.[0]).toContain('tiles.mapterhorn.com')
  })
})
