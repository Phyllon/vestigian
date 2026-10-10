import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BackgroundLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  RasterDEMSourceSpecification,
  SymbolLayerSpecification,
  RasterSourceSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl'
import type { BasemapSource } from '#shared/types'
import {
  BASEMAP_VIEWS,
  LIMES_ATTRIBUTION,
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
  empireExtentTilesUrl: 'http://localhost:3000/api/tiles/antiquity-empire',
  battleTilesUrl: 'http://localhost:3000/api/tiles/antiquity-battles',
  portTilesUrl: 'http://localhost:3000/api/tiles/antiquity-ports',
  routeTilesUrl: 'http://localhost:3000/api/tiles/antiquity-routes',
  featureTilesUrl: 'http://localhost:3000/api/tiles/antiquity-features',
  coinHoardTilesUrl: 'http://localhost:3000/api/tiles/antiquity-coin-hoards',
  inscriptionTilesUrl: 'http://localhost:3000/api/tiles/inscriptions',
  atticInscriptionTilesUrl: 'http://localhost:3000/api/tiles/attic-inscriptions',
  referenceTilesUrl: 'http://localhost:3000/api/tiles/reference',
  polityTilesUrl: 'http://localhost:3000/api/tiles/antiquity-polities',
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

  // Production's `pmtiles` provider reads a Protomaps `build.protomaps.com`
  // extract, whose own vector schema names every one of these layers
  // differently from the OpenMapTiles/Tilezen schema OpenFreeMap serves in
  // dev (confirmed against https://docs.protomaps.com/basemaps/layers, v4).
  // `source-layer`/filter mismatches fail silently in MapLibre — no error,
  // just an empty layer — which is how city names, roads, buildings and
  // boundaries all went missing in production with nothing to catch it here
  // until now.
  it('reads the OpenMapTiles/Tilezen layer names dev’s OpenFreeMap source actually serves', () => {
    const style = buildBasemapStyle({
      view: 'vestigian',
      isDark: false,
      source: { ...source, provider: 'openfreemap' },
    })
    const byId = (id: string) => style.layers.find((layer) => layer.id === id)
    expect((byId('place-labels') as SymbolLayerSpecification)['source-layer']).toBe('place')
    expect((byId('buildings') as FillLayerSpecification)['source-layer']).toBe('building')
    expect((byId('roads-major') as LineLayerSpecification)['source-layer']).toBe('transportation')
    expect((byId('boundaries') as LineLayerSpecification)['source-layer']).toBe('boundary')
  })

  it('reads the Protomaps basemaps layer names production’s pmtiles source actually serves', () => {
    const style = buildBasemapStyle({
      view: 'vestigian',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const byId = (id: string) => style.layers.find((layer) => layer.id === id)
    expect((byId('place-labels') as SymbolLayerSpecification)['source-layer']).toBe('places')
    expect((byId('buildings') as FillLayerSpecification)['source-layer']).toBe('buildings')
    expect((byId('roads-major') as LineLayerSpecification)['source-layer']).toBe('roads')
    expect((byId('roads-major') as LineLayerSpecification).filter).toEqual([
      'in',
      'kind_detail',
      'motorway',
      'trunk',
      'primary',
    ])
    expect((byId('boundaries') as LineLayerSpecification)['source-layer']).toBe('boundaries')
    expect((byId('boundaries') as LineLayerSpecification).filter).toEqual(['==', 'kind', 'country'])
  })

  it('draws city names a shade under full strength, never fully opaque or invisible', () => {
    const style = buildBasemapStyle({ view: 'vestigian', isDark: false, source })
    const labels = style.layers.find(
      (layer) => layer.id === 'place-labels',
    ) as SymbolLayerSpecification
    expect(labels.paint?.['text-opacity']).toBeCloseTo(0.7)
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

  it('does not ask a mirror for the zooms it starts below', () => {
    // The mirror pyramid starts at z3. A declared minzoom of 0 requested z0–2
    // tiles that exist only on EOX's live server, so they 404 once mirrored.
    expect(satelliteSource().minzoom).toBe(3)
    expect(dareSource().minzoom).toBe(3)
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

  it('draws modern city names over the photograph, full strength', () => {
    const style = buildBasemapStyle({ view: 'satellite', isDark: false, source })
    const labels = style.layers.find((layer) => layer.id === 'place-labels') as
      SymbolLayerSpecification | undefined
    expect(labels?.['source-layer']).toBe('place')
    expect(labels?.paint?.['text-opacity']).toBeCloseTo(1)
    // Photography has no dark mode of its own — the sheet is light-toned in
    // both themes, and so is this label's ink, same reasoning as the
    // background colour just above.
    expect(labels?.paint?.['text-color']).toBe('#000000')
  })

  it('reads the Protomaps places layer for city names when production’s pmtiles source is active', () => {
    const style = buildBasemapStyle({
      view: 'satellite',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const labels = style.layers.find((layer) => layer.id === 'place-labels') as
      SymbolLayerSpecification | undefined
    expect(labels?.['source-layer']).toBe('places')
  })
})

describe('buildBasemapStyle, osm-standard view', () => {
  it('draws a colour table of its own, not vestigian’s palette at a different opacity', () => {
    // The whole point of this view is to look like the recognisable
    // OpenStreetMap map, not like vestigian turned up — see the docstring on
    // `OSM_STANDARD_COLOURS` for the 'modern' view this already went wrong
    // once with.
    const vestigianStyle = buildBasemapStyle({ view: 'vestigian', isDark: false, source })
    const osmStyle = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const background = (style: typeof vestigianStyle) =>
      (style.layers.find((layer) => layer.id === 'background') as BackgroundLayerSpecification)
        .paint?.['background-color']
    const water = (style: typeof vestigianStyle) =>
      (style.layers.find((layer) => layer.id === 'water') as FillLayerSpecification).paint?.[
        'fill-color'
      ]
    expect(background(osmStyle)).not.toBe(background(vestigianStyle))
    expect(water(osmStyle)).not.toBe(water(vestigianStyle))
  })

  it('draws every road tier as a cased pair, the classic OSM look a single flat line cannot give', () => {
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const byId = (id: string) =>
      style.layers.find((layer) => layer.id === id) as LineLayerSpecification | undefined
    for (const tier of ['roads-local', 'roads-secondary', 'roads-primary', 'roads-motorway']) {
      const casing = byId(`${tier}-casing`)
      const fill = byId(`${tier}-fill`)
      expect(casing?.paint?.['line-color']).toBeDefined()
      expect(fill?.paint?.['line-color']).toBeDefined()
      expect(casing?.paint?.['line-color']).not.toBe(fill?.paint?.['line-color'])
      // The casing is what actually reads as an "edge" — a casing no wider
      // than its own fill is pointless, see `buildRoadTierLayers`'s docstring.
      expect(JSON.stringify(casing?.paint?.['line-width'])).not.toBe(
        JSON.stringify(fill?.paint?.['line-width']),
      )
    }
  })

  it('draws motorways in red over primary in orange over secondary in pale yellow — OSM-Carto’s own road colours, not an invented palette', () => {
    // Read straight from gravitystorm/openstreetmap-carto's own
    // style/road-colors-generated.mss, not approximated — see
    // `OSM_STANDARD_COLOURS`'s docstring for exactly which files.
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const byId = (id: string) =>
      style.layers.find((layer) => layer.id === id) as LineLayerSpecification | undefined
    expect(byId('roads-motorway-fill')?.paint?.['line-color']).toBe('#e892a2')
    expect(byId('roads-primary-fill')?.paint?.['line-color']).toBe('#fcd6a4')
    expect(byId('roads-secondary-fill')?.paint?.['line-color']).toBe('#f7fabf')
    expect(byId('roads-local-fill')?.paint?.['line-color']).toBe('#ffffff')
  })

  it('draws a forest/grass fill vestigian has no equivalent layer for at all', () => {
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const forest = style.layers.find((layer) => layer.id === 'forest') as
      FillLayerSpecification | undefined
    const vegetation = style.layers.find((layer) => layer.id === 'vegetation') as
      FillLayerSpecification | undefined
    expect(forest?.paint?.['fill-color']).toBe('#add19e')
    expect(vegetation?.paint?.['fill-color']).toBe('#cdebb0')
    const vestigianStyle = buildBasemapStyle({ view: 'vestigian', isDark: false, source })
    expect(vestigianStyle.layers.find((layer) => layer.id === 'forest')).toBeUndefined()
  })

  it('draws city names at full strength, matching the other full-detail views', () => {
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const labels = style.layers.find((layer) => layer.id === 'place-labels') as
      SymbolLayerSpecification | undefined
    expect(labels?.paint?.['text-opacity']).toBeCloseTo(1)
  })

  it('reads the OpenMapTiles/Tilezen layer names dev’s OpenFreeMap source serves', () => {
    const style = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'openfreemap' },
    })
    const byId = (id: string) => style.layers.find((layer) => layer.id === id)
    expect((byId('place-labels') as SymbolLayerSpecification)['source-layer']).toBe('place')
    expect((byId('roads-motorway-fill') as LineLayerSpecification)['source-layer']).toBe(
      'transportation',
    )
    expect((byId('forest') as FillLayerSpecification)['source-layer']).toBe('landcover')
  })

  it('reads the Protomaps basemaps layer names production’s pmtiles source serves', () => {
    const style = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const byId = (id: string) => style.layers.find((layer) => layer.id === id)
    expect((byId('place-labels') as SymbolLayerSpecification)['source-layer']).toBe('places')
    expect((byId('roads-motorway-fill') as LineLayerSpecification)['source-layer']).toBe('roads')
    // Protomaps' own `landcover` layer only goes to z7 — forest/grass here
    // has to read `landuse`'s own `kind` instead, a different source-layer
    // entirely, not just a different name for the same one.
    expect((byId('forest') as FillLayerSpecification)['source-layer']).toBe('landuse')
  })

  it('draws rivers and streams, not just lakes — a river narrow enough to be a line, not a polygon, still has to show', () => {
    const openfreemap = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'openfreemap' },
    })
    const pmtiles = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const waterway = (style: typeof openfreemap) =>
      style.layers.find((layer) => layer.id === 'waterway') as LineLayerSpecification | undefined
    // OpenMapTiles keeps rivers in their own `waterway` layer; Protomaps'
    // own docs state its `water` layer carries "polygons, lines and point
    // labels" together, so the line geometry is read from the same layer
    // the lake/sea fill already uses, filtered to the linear `kind_detail`
    // values so a lake's own polygon outline isn't drawn a second time.
    expect(waterway(openfreemap)?.['source-layer']).toBe('waterway')
    expect(waterway(openfreemap)?.filter).toBeUndefined()
    expect(waterway(pmtiles)?.['source-layer']).toBe('water')
    expect(JSON.stringify(waterway(pmtiles)?.filter)).toContain('river')
  })

  it('labels mountain peaks by name only — elevation is asymmetric between providers and was dropped from both on request', () => {
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const peaks = style.layers.find((layer) => layer.id === 'peak-labels') as
      SymbolLayerSpecification | undefined
    expect(peaks?.layout?.['text-field']).toEqual(['concat', '▲ ', ['get', 'name']])
    expect(JSON.stringify(peaks?.layout?.['text-field'])).not.toContain('ele')
  })

  it('reads peaks from each provider’s real schema — a dedicated layer in OpenMapTiles, a filtered POI kind in Protomaps', () => {
    const openfreemap = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'openfreemap' },
    })
    const pmtiles = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const peaks = (style: typeof openfreemap) =>
      style.layers.find((layer) => layer.id === 'peak-labels') as
        SymbolLayerSpecification | undefined
    expect(peaks(openfreemap)?.['source-layer']).toBe('mountain_peak')
    // No per-provider filter for OpenMapTiles — the whole layer is peaks —
    // so the merged filter must still be a real array, not `undefined`:
    // the exact shape that broke `waterway` once already (see
    // `buildNamedFeatureFilter`'s docstring).
    expect(Array.isArray(peaks(openfreemap)?.filter)).toBe(true)
    expect(peaks(pmtiles)?.['source-layer']).toBe('pois')
    expect(JSON.stringify(peaks(pmtiles)?.filter)).toContain('peak')
  })

  it('labels rivers and roads along their own line, not as a floating point', () => {
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const byId = (id: string) =>
      style.layers.find((layer) => layer.id === id) as SymbolLayerSpecification | undefined
    expect(byId('waterway-name-labels')?.layout?.['symbol-placement']).toBe('line')
    expect(byId('road-name-labels')?.layout?.['symbol-placement']).toBe('line')
  })

  it('reads road names from OpenMapTiles’ separate transportation_name layer, since the line geometry layer itself carries no name field', () => {
    // Confirmed against the real OpenFreeMap TileJSON before writing this:
    // `transportation`'s own field list has no `name` at all.
    const openfreemap = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'openfreemap' },
    })
    const pmtiles = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const roadNames = (style: typeof openfreemap) =>
      style.layers.find((layer) => layer.id === 'road-name-labels') as
        SymbolLayerSpecification | undefined
    expect(roadNames(openfreemap)?.['source-layer']).toBe('transportation_name')
    expect(roadNames(pmtiles)?.['source-layer']).toBe('roads')
  })

  it('reads lake/sea names from OpenMapTiles’ separate water_name layer, and from the same water layer already drawn in Protomaps', () => {
    const openfreemap = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'openfreemap' },
    })
    const pmtiles = buildBasemapStyle({
      view: 'osm-standard',
      isDark: false,
      source: { ...source, provider: 'pmtiles', pmtilesUrl: 'https://cdn.example/basemap.pmtiles' },
    })
    const waterNames = (style: typeof openfreemap) =>
      style.layers.find((layer) => layer.id === 'water-name-labels') as
        SymbolLayerSpecification | undefined
    expect(waterNames(openfreemap)?.['source-layer']).toBe('water_name')
    expect(waterNames(pmtiles)?.['source-layer']).toBe('water')
  })

  it('draws every named-feature label after place-labels, so town names keep collision priority', () => {
    const style = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const order = style.layers.map((layer) => layer.id)
    const placeIndex = order.indexOf('place-labels')
    for (const id of [
      'peak-labels',
      'water-name-labels',
      'waterway-name-labels',
      'road-name-labels',
    ]) {
      expect(order.indexOf(id)).toBeGreaterThan(placeIndex)
    }
  })

  it('stays the same sheet regardless of the reader’s theme', () => {
    // Unlike vestigian, this view is meant to read as the one familiar OSM
    // look — there is no authoritative "OSM dark mode" to switch to.
    const light = buildBasemapStyle({ view: 'osm-standard', isDark: false, source })
    const dark = buildBasemapStyle({ view: 'osm-standard', isDark: true, source })
    expect(dark).toEqual(light)
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

  it('keeps the sheet light over the OSM-standard view even at night', () => {
    // This view is meant to look like the one familiar OSM reference map,
    // which has no dark variant of its own to defer to.
    expect(resolveSheetTone('osm-standard', true)).toBe('light')
    expect(resolveSheetTone('osm-standard', false)).toBe('light')
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
      'atlas-centuriation-blocks',
      'atlas-centuriation-lines',
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
  /**
   * The extent-over-time fill is no longer part of this style at all — it is
   * drawn by `usePeriodOverlay` above whichever basemap is showing (see
   * `usePeriodOverlay.test.ts` for the layer specs, the same split
   * `useLimesOverlay.test.ts` already made for the frontier). What's left
   * here is confirming the Barrington sheet never grew its own period
   * source or layers even before that extraction.
   */
  it('never added a period source or layers of its own', () => {
    const style = atlasStyle()
    expect(style.sources['atlas-period']).toBeUndefined()
    expect(layerIds(style).some((id) => id.startsWith('atlas-period'))).toBe(false)
  })

  it('credits every source the frontier is drawn from, and says which part is derived', () => {
    // The solid lines are traced from three third-party sources and the dashed
    // ones are derived from AWMC's extent of the empire, not a dataset anyone
    // published. A reader is owed both before they cite it — and it is carried
    // on the frontier's *own* source (`useLimesOverlay`), not the antiquity
    // sheet's, because the frontier is drawn over basemaps that have no `atlas`
    // source at all.
    for (const credit of ['OpenStreetMap', 'OpenHistoricalMap', 'vici.org']) {
      expect(LIMES_ATTRIBUTION).toContain(credit)
    }
    expect(LIMES_ATTRIBUTION).toContain('Ancient World Mapping Center')
    expect(LIMES_ATTRIBUTION).toContain('derived')
    expect(LIMES_ATTRIBUTION).toContain('ODbL')

    // The sheet itself credits its own two sources either way, so turning the
    // frontier on never drops AWMC and Pleiades from the sheet's credit line.
    const attribution = (limesStyle().sources.atlas as VectorSourceSpecification).attribution ?? ''
    expect(attribution).toContain('Ancient World Mapping Center')
    expect(attribution).toContain('Pleiades')
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
    expect(BASEMAP_VIEWS).toHaveLength(5)
  })

  it('offers the OSM-standard view alongside vestigian and satellite, not among the antiquity sheets', () => {
    const option = BASEMAP_VIEWS.find((entry) => entry.value === 'osm-standard')
    expect(option?.group).toBe('today')
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

  describe('a PMTiles elevation mirror', () => {
    const terrain = (terrainUrl: string) =>
      atlasStyle({ terrainUrl }).sources.terrain as RasterDEMSourceSpecification

    it('is addressed by `url`, with the protocol prefix added when it is missing', () => {
      const bare = terrain('https://mirror.example/terrain.pmtiles')
      expect(bare.url).toBe('pmtiles://https://mirror.example/terrain.pmtiles')
      expect(bare.tiles).toBeUndefined()
      expect(bare.encoding).toBe('terrarium')
      expect(bare.tileSize).toBe(512)
    })

    it('keeps an explicit protocol prefix as it is and states no zoom limit of its own', () => {
      const prefixed = terrain('pmtiles://https://mirror.example/terrain.pmtiles')
      expect(prefixed.url).toBe('pmtiles://https://mirror.example/terrain.pmtiles')
      expect(prefixed.maxzoom).toBeUndefined()
    })

    it('is told apart from a tile template by the extension, query string included', () => {
      expect(terrain('https://mirror.example/t.pmtiles?v=2').url).toContain('pmtiles://')
      expect(terrain('https://mirror.example/{z}/{x}/{y}.webp').tiles?.[0]).toContain('{z}')
    })

    it('credits Mapterhorn and links to the sources it lists', () => {
      expect(terrain('https://mirror.example/terrain.pmtiles').attribution).toContain(
        'mapterhorn.com/attribution',
      )
    })
  })

  describe('in a production build', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('draws no relief from the public fallback, which is a Cloudflare-fronted host', () => {
      vi.stubEnv('PROD', true)
      const style = atlasStyle({ terrainUrl: '' })

      expect(style.sources.terrain).toBeUndefined()
      expect(style.layers.some((layer) => layer.id === 'atlas-hillshade')).toBe(false)
    })

    it('keeps the relief when the deployment configured its own elevation source', () => {
      vi.stubEnv('PROD', true)
      const style = atlasStyle({ terrainUrl: 'https://mirror.example/{z}/{x}/{y}.webp' })

      expect(style.sources.terrain).toBeDefined()
      expect(style.layers.some((layer) => layer.id === 'atlas-hillshade')).toBe(true)
    })
  })
})
