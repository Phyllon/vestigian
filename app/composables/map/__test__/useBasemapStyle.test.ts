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
  satelliteUrl: '',
  atlasTilesUrl: 'http://localhost:3000/api/tiles/antiquity',
  limesTilesUrl: 'http://localhost:3000/api/tiles/limes',
  periodExtentTilesUrl: 'http://localhost:3000/api/tiles/antiquity-periods',
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

const satelliteSource = (overrides: Partial<BasemapSource> = {}) => {
  const style = buildBasemapStyle({
    view: 'satellite',
    isDark: false,
    source: { ...source, ...overrides },
  })
  return style.sources.satellite as RasterSourceSpecification
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
    const style = buildBasemapStyle({ view: 'vestigian', isDark: false, source })
    const labels = style.layers.find((layer) => layer.id === 'place-labels')
    expect(labels?.type === 'symbol' && labels.layout?.['text-font']).toEqual([MAP_LABEL_FONT])
  })

  it('serves glyphs from this origin rather than a font server', () => {
    const style = buildBasemapStyle({ view: 'vestigian', isDark: false, source })
    expect(style.glyphs).not.toMatch(/^https?:/)
  })
})

describe('buildBasemapStyle, satellite view', () => {
  it('reads tile coordinates as z/y/x, not the usual z/x/y', () => {
    // Confirmed against EOX's own WMTS capabilities document and by fetching
    // the same coordinate both ways: their path segments are
    // {TileMatrix}/{TileRow}/{TileCol}, i.e. row (y) before column (x). Every
    // other raster source in this file is z/x/y — getting this backwards
    // would silently mirror or request the wrong tile at any coordinate that
    // is not on the diagonal.
    const tiles = satelliteSource().tiles ?? []
    expect(tiles[0]).toMatch(/\{z\}\/\{y\}\/\{x\}/)
  })

  it('stops at the zoom a mirror would actually hold', () => {
    // Sentinel-2's real resolution is ~10m/pixel, which lands at this zoom —
    // past it the upstream server is upsampling, not showing more detail.
    expect(satelliteSource().maxzoom).toBe(13)
  })

  it('prefers a configured mirror over asking EOX directly', () => {
    const mirrored = satelliteSource({
      satelliteUrl: 'https://cdn.example/basemap/satellite/{z}/{y}/{x}.jpg',
    })
    expect(mirrored.tiles).toEqual(['https://cdn.example/basemap/satellite/{z}/{y}/{x}.jpg'])
    expect(satelliteSource().tiles?.[0]).toContain('tiles.maps.eox.at')
  })

  it('carries the attribution the licence requires', () => {
    const attribution = satelliteSource().attribution ?? ''
    expect(attribution).toContain('<a href=')
    expect(attribution).toContain('EOX')
    expect(attribution).toContain('CC BY-NC-SA')
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

  it('keeps the sheet light over the satellite photograph even at night', () => {
    // Real imagery has no dark mode of its own to switch to, the same problem
    // as the antiquity rasters from the other direction.
    expect(resolveSheetTone('satellite', true)).toBe('light')
    expect(resolveSheetTone('satellite', false)).toBe('light')
  })

  it('follows the theme everywhere else', () => {
    expect(resolveSheetTone('vestigian', true)).toBe('dark')
    expect(resolveSheetTone('vestigian', false)).toBe('light')
  })
})

describe('the frontier — what the Barrington sheet itself still does for it', () => {
  /**
   * The frontier line is no longer part of this style at all — it is drawn by
   * `useLimesOverlay` above whichever basemap is showing (see that module's
   * own tests for the layer specs). What's left here is what the Barrington
   * sheet does to make room for it: the rest of the sheet recedes, and the
   * general place layer stops drawing the military places the frontier's own
   * layer draws instead.
   */
  it('leaves the Barrington sheet exactly as it was when the switch is off', () => {
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

  it('never adds a limes source or layers of its own, even with the flag on', () => {
    // Only `useLimesOverlay` does that now, on top of the rendered map — this
    // style itself only reacts to the flag by dimming and filtering.
    expect(limesStyle().sources.limes).toBeUndefined()
    expect(layerIds(limesStyle()).some((id) => id.startsWith('limes-'))).toBe(false)
  })
})

describe('the period scrubber', () => {
  const periodStyle = (periodYear: -60 | 117 | 200 | null) =>
    buildBasemapStyle({ view: 'antiquity-awmc', isDark: false, source, periodYear })

  it('adds no source or layers at all at the default "off" position', () => {
    // A reader who never touches the scrubber should request nothing from
    // /api/tiles/antiquity-periods — the same reasoning `useLimesOverlay`'s
    // own tests already apply to the frontier.
    const off = periodStyle(null)
    expect(off.sources['atlas-period']).toBeUndefined()
    expect(layerIds(off).some((id) => id.startsWith('atlas-period'))).toBe(false)
  })

  it('bakes the selected year into the tile URL, not a query param', () => {
    const style = periodStyle(117)
    const extentSource = style.sources['atlas-period'] as VectorSourceSpecification
    expect(extentSource.tiles).toEqual([
      'http://localhost:3000/api/tiles/antiquity-periods/117/{z}/{x}/{y}.mvt',
    ])
    expect(layerIds(style)).toEqual(
      expect.arrayContaining(['atlas-period-extent', 'atlas-period-extent-outline']),
    )
  })

  it('draws the fill under the urban and road linework', () => {
    // A city or a route on the sheet should still read as itself, not be
    // tinted by the extent wash under it.
    const ids = layerIds(periodStyle(200))
    expect(ids.indexOf('atlas-period-extent')).toBeLessThan(ids.indexOf('atlas-urban'))
    expect(ids.indexOf('atlas-period-extent')).toBeLessThan(ids.indexOf('atlas-roads'))
  })

  it('says the frontier is derived rather than surveyed', () => {
    // It is the boundary of AWMC's extent of the empire with the coast taken
    // out of it, not a dataset anyone published. A reader is owed that before
    // they cite it.
    const attribution = (limesStyle().sources.atlas as VectorSourceSpecification).attribution ?? ''
    expect(attribution).toContain('Ancient World Mapping Center')
    expect(attribution).toContain('derived')
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
