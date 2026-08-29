import { describe, expect, it } from 'vitest'
import type {
  LineLayerSpecification,
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
    const style = buildBasemapStyle({ view: 'vestigia', isDark: false, source })
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
