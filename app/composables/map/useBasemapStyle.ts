import { Protocol } from 'pmtiles'
import maplibregl from 'maplibre-gl'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type {
  BasemapGroup,
  BasemapOption,
  BasemapSheetTone,
  BasemapSource,
  BasemapView,
} from '#shared/types'

let protocolRegistered = false

/**
 * PMTiles is read straight from object storage over HTTP range requests, so no
 * tile server process exists to run, scale or pay for. The protocol handler has
 * to be registered on MapLibre once per page, before any style referencing it.
 */
const registerPmtilesProtocol = (): void => {
  if (protocolRegistered) return
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

/**
 * The one fontstack every label layer asks for. Written out in three places
 * before this constant existed, and the glyphs are now served from this repo:
 * a name that disagrees with the directory under `public/fonts/` renders every
 * label blank and logs nothing worth reading, so the two are tied together
 * here rather than restated per layer.
 */
export const MAP_LABEL_FONT = 'Noto Sans Regular'

/**
 * The zoom the mirrored DARE pyramid actually holds. The upstream server stops
 * at 11, and z11 alone would be three quarters of the tiles for a level nobody
 * reads the base at, so the mirror stops at 10 and MapLibre overzooms above —
 * softer, but present. Declaring it on the source is what makes that happen;
 * without it MapLibre requests z11+ and gets a 404, and the map goes empty
 * exactly where sites become individual markers.
 */
const DARE_MAX_ZOOM = 10

/**
 * The Digital Atlas of the Roman Empire, as raster tiles.
 *
 * Johan Åhlfeldt's terms page grants reuse under CC BY-SA 3.0 with attribution
 * and a link. Its own legend, however, credits two inputs as CC BY-NC 3.0
 * (AWMC's Barrington roads) and CC BY-NC-SA (the Roman roads of Britain), which
 * the blanket BY-SA cannot cover: the rendered tiles bake in layers DARE itself
 * calls non-commercial. AWMC has since relicensed its geodata to ODbL, which
 * probably settles it, but nobody has updated DARE's credits to say so. Fine
 * for an atlas that earns nothing; the wrong dependency the day it does.
 */
const DARE_TILES = 'https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png'

const DARE_ATTRIBUTION =
  'Antiquity base © <a href="https://imperium.ahlfeldt.se" target="_blank" rel="noopener">Digital Atlas of the Roman Empire</a>, Johan Åhlfeldt (CC BY-SA 3.0)'

/**
 * The AWMC sheet is ours to draw, not someone else's to borrow.
 *
 * The CAWM tile server publishes only physical relief — no roads, no names, no
 * settlements — so mirroring it would have produced a beautiful empty map. The
 * information that makes it an atlas is published separately as open data, and
 * `/api/tiles/antiquity` now serves it from this project's own PostGIS: AWMC's
 * Barrington-derived geodata under ODbL 1.0 and Pleiades places under CC BY 3.0.
 */
const ATLAS_ATTRIBUTION =
  'Antiquity data © <a href="https://github.com/AWMC/geodata" target="_blank" rel="noopener">Ancient World Mapping Center</a> (ODbL 1.0) and <a href="https://pleiades.stoa.org" target="_blank" rel="noopener">Pleiades</a> (CC BY 3.0)'

/** Neither antiquity view is a recolouring of the modern vector source. */
export type AntiquityView = Extract<BasemapView, 'antiquity-dare' | 'antiquity-awmc'>

export const isAntiquityView = (view: BasemapView): view is AntiquityView =>
  view === 'antiquity-dare' || view === 'antiquity-awmc'

/**
 * What the overlay is drawn on, which is not the same question as which theme
 * the reader chose. An antiquity raster is parchment at midnight too, so the
 * night palette — pale ink on a dark disc — would put invisible markers on a
 * bright sheet. Everything drawing over the basemap reads this, not `isDark`.
 */
export const resolveSheetTone = (view: BasemapView, isDark: boolean): BasemapSheetTone => {
  if (isAntiquityView(view)) return 'light'
  return isDark ? 'dark' : 'light'
}

interface StyleColours {
  land: string
  water: string
  landuse: string
  road: string
  roadMajor: string
  building: string
  label: string
  labelHalo: string
  boundary: string
}

/**
 * The notebook palette translated into map terms. Land is paper, water is a
 * wash of dilute ink, and modern roads are drawn as faint pencil so the
 * archaeological overlay is always the darkest thing on the map.
 */
const LIGHT_COLOURS: StyleColours = {
  land: '#f2ede1',
  water: '#cfd7d3',
  landuse: '#e7dfcd',
  road: '#dcd3bf',
  roadMajor: '#cfc3a8',
  building: '#e2d9c6',
  label: '#3d362e',
  labelHalo: '#faf7ef',
  boundary: '#b9ab8d',
}

const DARK_COLOURS: StyleColours = {
  land: '#17140f',
  water: '#10161a',
  landuse: '#211d17',
  road: '#332c22',
  roadMajor: '#443b2d',
  building: '#241f19',
  label: '#e7dfcd',
  labelHalo: '#17140f',
  boundary: '#3d362c',
}

/** Modern view: full road hierarchy and settlement labels, as on a road map. */
const MODERN_ROAD_OPACITY = 1
/** Vestigia view: modern infrastructure present but pushed to the background. */
const QUIET_ROAD_OPACITY = 0.35

interface StyleRequest {
  view: BasemapView
  isDark: boolean
  source: BasemapSource
}

const buildVectorSource = (source: BasemapSource) =>
  source.provider === 'pmtiles'
    ? {
        type: 'vector' as const,
        url: `pmtiles://${source.pmtilesUrl}`,
        attribution: '© OpenStreetMap contributors',
      }
    : {
        type: 'vector' as const,
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '© OpenStreetMap contributors',
      }

const buildBasemapLayers = (colours: StyleColours, roadOpacity: number): LayerSpecification[] => [
  {
    id: 'background',
    type: 'background',
    paint: { 'background-color': colours.land },
  },
  {
    id: 'landuse',
    type: 'fill',
    source: 'basemap',
    'source-layer': 'landuse',
    paint: { 'fill-color': colours.landuse, 'fill-opacity': 0.5 },
  },
  {
    id: 'water',
    type: 'fill',
    source: 'basemap',
    'source-layer': 'water',
    paint: { 'fill-color': colours.water },
  },
  {
    id: 'buildings',
    type: 'fill',
    source: 'basemap',
    'source-layer': 'building',
    minzoom: 14,
    paint: { 'fill-color': colours.building, 'fill-opacity': roadOpacity * 0.8 },
  },
  {
    id: 'roads-minor',
    type: 'line',
    source: 'basemap',
    'source-layer': 'transportation',
    filter: ['!in', 'class', 'motorway', 'trunk', 'primary'],
    minzoom: 11,
    paint: {
      'line-color': colours.road,
      'line-opacity': roadOpacity,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 18, 3],
    },
  },
  {
    id: 'roads-major',
    type: 'line',
    source: 'basemap',
    'source-layer': 'transportation',
    filter: ['in', 'class', 'motorway', 'trunk', 'primary'],
    paint: {
      'line-color': colours.roadMajor,
      'line-opacity': roadOpacity,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 18, 6],
    },
  },
  {
    id: 'boundaries',
    type: 'line',
    source: 'basemap',
    'source-layer': 'boundary',
    filter: ['<=', 'admin_level', 2],
    paint: {
      'line-color': colours.boundary,
      'line-dasharray': [3, 2],
      'line-width': 0.8,
      'line-opacity': 0.6,
    },
  },
  {
    id: 'place-labels',
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'place',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [MAP_LABEL_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 14, 15],
      'text-max-width': 8,
    },
    paint: {
      'text-color': colours.label,
      'text-halo-color': colours.labelHalo,
      'text-halo-width': 1.2,
      'text-opacity': roadOpacity < 1 ? 0.7 : 1,
    },
  },
]

/**
 * The mirror in object storage if one is configured, Gothenburg's own server
 * otherwise. The fallback is what lets a fresh clone show the map with no
 * import run at all; it is also a research server being asked to serve a
 * development session, which is why `.env.example` says to set this in
 * production and the mirror script exists.
 */
const resolveDareUrl = (source: BasemapSource): string =>
  source.antiquityDareUrl.length > 0 ? source.antiquityDareUrl : DARE_TILES

/**
 * DARE, as printed. Raster tiles carry their own cartography, so there is
 * nothing to style: the sheet is the map.
 *
 * The background stays paper in both themes. These tiles are opaque parchment
 * and only the edge of coverage shows through, so a night-coloured backdrop
 * would read as a hole in the sheet rather than as the dark it is elsewhere.
 */
const buildDareStyle = (source: BasemapSource): StyleSpecification => ({
  version: 8,
  glyphs: source.glyphsUrl,
  sources: {
    antiquity: {
      type: 'raster',
      tiles: [resolveDareUrl(source)],
      tileSize: 256,
      minzoom: 3,
      maxzoom: DARE_MAX_ZOOM,
      attribution: DARE_ATTRIBUTION,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': LIGHT_COLOURS.land } },
    { id: 'antiquity', type: 'raster', source: 'antiquity' },
  ],
})

interface AtlasColours {
  land: string
  sea: string
  inland: string
  coast: string
  road: string
  roadMajor: string
  infrastructure: string
  urban: string
  label: string
  labelHalo: string
  regionLabel: string
}

/**
 * The atlas in notebook terms. Sea is a dilute ink wash, land is the paper
 * itself, and the Roman roads are the darkest thing on the sheet because they
 * are what the map is for. Drawn from the same tokens as the rest of the
 * interface, as hex literals — see the note on the modern palettes above.
 */
const ATLAS_COLOURS: AtlasColours = {
  land: '#f2ede1',
  sea: '#c8d3d0',
  inland: '#bccbc8',
  coast: '#8c8271',
  road: '#7d6a4a',
  roadMajor: '#5c4b33',
  infrastructure: '#9a3b22',
  urban: '#ded2b8',
  label: '#3d362e',
  labelHalo: '#faf7ef',
  regionLabel: '#6b6154',
}

/**
 * The antiquity atlas, drawn from this project's own vector tiles.
 *
 * Order is the whole trick with a sheet assembled from separate sources: sea
 * over the paper background, then the coastline drawn as a line on top of it so
 * the edge stays crisp where the simplified polygons and the shoreline linework
 * disagree, then the built things, then the names.
 *
 * A road whose course Barrington records as inferred rather than established is
 * dashed. That distinction is in the data and the map has no business flattening
 * it — a solid line here would be the atlas asserting more than its source does.
 */
const buildAtlasStyle = (source: BasemapSource): StyleSpecification => ({
  version: 8,
  glyphs: source.glyphsUrl,
  sources: {
    atlas: {
      type: 'vector',
      tiles: [`${source.atlasTilesUrl}/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 12,
      attribution: ATLAS_ATTRIBUTION,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': ATLAS_COLOURS.land } },
    {
      id: 'atlas-sea',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'water',
      filter: ['==', ['get', 'kind'], 'sea'],
      paint: { 'fill-color': ATLAS_COLOURS.sea },
    },
    {
      id: 'atlas-inland-water',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'water',
      filter: ['==', ['get', 'kind'], 'inland'],
      paint: { 'fill-color': ATLAS_COLOURS.inland },
    },
    {
      id: 'atlas-urban',
      type: 'fill',
      source: 'atlas',
      'source-layer': 'areas',
      paint: { 'fill-color': ATLAS_COLOURS.urban, 'fill-opacity': 0.85 },
    },
    {
      id: 'atlas-coast',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['==', ['get', 'kind'], 'shoreline'],
      paint: {
        'line-color': ATLAS_COLOURS.coast,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 12, 1.2],
      },
    },
    {
      id: 'atlas-infrastructure',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['in', ['get', 'kind'], ['literal', ['aqueduct', 'canal', 'wall']]],
      paint: {
        'line-color': ATLAS_COLOURS.infrastructure,
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 14, 2.4],
      },
    },
    {
      id: 'atlas-roads-inferred',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['all', ['==', ['get', 'kind'], 'road'], ['!', ['get', 'certain']]],
      paint: {
        'line-color': ATLAS_COLOURS.road,
        'line-dasharray': [2, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 14, 2],
      },
    },
    {
      id: 'atlas-roads',
      type: 'line',
      source: 'atlas',
      'source-layer': 'lines',
      filter: ['all', ['==', ['get', 'kind'], 'road'], ['get', 'certain']],
      paint: {
        'line-color': ['case', ['get', 'major'], ATLAS_COLOURS.roadMajor, ATLAS_COLOURS.road],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          ['case', ['get', 'major'], 0.9, 0.5],
          14,
          ['case', ['get', 'major'], 3.2, 1.8],
        ],
      },
    },
    {
      id: 'atlas-place-labels',
      type: 'symbol',
      source: 'atlas',
      'source-layer': 'places',
      minzoom: 6,
      layout: {
        'text-field': ['get', 'title'],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 9, 14, 13],
        'text-max-width': 8,
        'text-padding': 4,
      },
      paint: {
        'text-color': ATLAS_COLOURS.label,
        'text-halo-color': ATLAS_COLOURS.labelHalo,
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'atlas-region-labels',
      type: 'symbol',
      source: 'atlas',
      'source-layer': 'regions',
      layout: {
        'text-field': ['get', 'title'],
        'text-font': [MAP_LABEL_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 9, 15],
        'text-letter-spacing': 0.18,
        'text-transform': 'uppercase',
        'text-max-width': 9,
      },
      paint: {
        'text-color': ATLAS_COLOURS.regionLabel,
        'text-halo-color': ATLAS_COLOURS.labelHalo,
        'text-halo-width': 1.4,
      },
    },
  ],
})

export const buildBasemapStyle = (request: StyleRequest): StyleSpecification => {
  if (request.view === 'antiquity-dare') return buildDareStyle(request.source)
  if (request.view === 'antiquity-awmc') return buildAtlasStyle(request.source)

  const colours = request.isDark ? DARK_COLOURS : LIGHT_COLOURS
  const roadOpacity = request.view === 'modern' ? MODERN_ROAD_OPACITY : QUIET_ROAD_OPACITY

  if (request.source.provider === 'pmtiles') registerPmtilesProtocol()

  const style: StyleSpecification = {
    version: 8,
    glyphs: request.source.glyphsUrl,
    sources: { basemap: buildVectorSource(request.source) },
    layers: buildBasemapLayers(colours, roadOpacity),
  }

  if (request.view === 'terrain') {
    style.sources.terrain = {
      type: 'raster-dem',
      tiles: [request.source.terrainUrl],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Elevation: Mapzen / AWS Open Data',
    }
    style.layers.splice(1, 0, {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.4,
        'hillshade-shadow-color': request.isDark ? '#000000' : '#8c8271',
        'hillshade-highlight-color': request.isDark ? '#2e2820' : '#faf7ef',
      },
    })
  }

  return style
}

export const BASEMAP_VIEWS: BasemapOption[] = [
  { value: 'vestigia', group: 'today', label: 'Vestigia', hint: 'Antiquity foregrounded' },
  { value: 'modern', group: 'today', label: 'Modern', hint: 'Roads and towns today' },
  { value: 'terrain', group: 'today', label: 'Terrain', hint: 'Relief and elevation' },
  {
    value: 'antiquity-dare',
    group: 'antiquity',
    label: 'Antiquity (DARE)',
    hint: 'Digital Atlas of the Roman Empire',
  },
  {
    value: 'antiquity-awmc',
    group: 'antiquity',
    label: 'Antiquity (Barrington)',
    hint: 'Roads, peoples and places, drawn here',
  },
]

export const BASEMAP_GROUP_LABELS: Record<BasemapGroup, string> = {
  today: 'Today',
  antiquity: 'Antiquity',
}

/**
 * Switching a MapLibre style replaces every source and layer, which would take
 * the site overlay with it. The overlay is therefore re-attached on the
 * styledata event that follows each swap, and the camera is left untouched so
 * the switch is visually a recolour rather than a reload.
 */
export const useBasemapStyle = () => {
  const config = useRuntimeConfig()
  const colorMode = useColorMode()
  const view = useState<BasemapView>('basemap-view', () => 'vestigia')

  /**
   * Tile URLs have to be absolute.
   *
   * MapLibre builds its tile requests inside a web worker, where a root-relative
   * path has no document to resolve against — `new Request('/api/tiles/...')`
   * throws "Failed to parse URL" and the source silently loads nothing while
   * the rest of the style renders normally. `useViewportTiles` already carries
   * the same workaround for the site overlay.
   *
   * `window` is not available while the style is first evaluated during SSR, so
   * the configured public site URL stands in; the value is only ever used by
   * the client, which re-evaluates with the real origin.
   */
  const origin = import.meta.client ? window.location.origin : config.public.siteUrl

  const absolute = (value: string): string =>
    value.startsWith('http') ? value : `${origin}${value}`

  const source = computed<BasemapSource>(() => ({
    provider: config.public.basemap.provider as BasemapSource['provider'],
    pmtilesUrl: config.public.basemap.pmtilesUrl,
    terrainUrl: config.public.basemap.terrainUrl,
    antiquityDareUrl: config.public.basemap.antiquityDareUrl,
    atlasTilesUrl: absolute(config.public.basemap.atlasTilesUrl),
    glyphsUrl: config.public.basemap.glyphsUrl,
  }))

  const isDark = computed(() => colorMode.value === 'dark')

  const sheetTone = computed(() => resolveSheetTone(view.value, isDark.value))

  const currentStyle = computed(() =>
    buildBasemapStyle({ view: view.value, isDark: isDark.value, source: source.value }),
  )

  const setView = (next: BasemapView): void => {
    view.value = next
  }

  return { view, setView, currentStyle, isDark, sheetTone, availableViews: BASEMAP_VIEWS }
}
