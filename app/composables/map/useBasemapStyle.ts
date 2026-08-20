import { Protocol } from 'pmtiles'
import maplibregl from 'maplibre-gl'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { BasemapSource, BasemapView } from '#shared/types'

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
    ? { type: 'vector' as const, url: `pmtiles://${source.pmtilesUrl}`, attribution: '© OpenStreetMap contributors' }
    : { type: 'vector' as const, url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors' }

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
      'text-font': ['Noto Sans Regular'],
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

export const buildBasemapStyle = (request: StyleRequest): StyleSpecification => {
  const colours = request.isDark ? DARK_COLOURS : LIGHT_COLOURS
  const roadOpacity = request.view === 'modern' ? MODERN_ROAD_OPACITY : QUIET_ROAD_OPACITY

  if (request.source.provider === 'pmtiles') registerPmtilesProtocol()

  const style: StyleSpecification = {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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

export const BASEMAP_VIEWS: { value: BasemapView; label: string; hint: string }[] = [
  { value: 'vestigia', label: 'Vestigia', hint: 'Antiquity foregrounded' },
  { value: 'modern', label: 'Modern', hint: 'Roads and towns today' },
  { value: 'terrain', label: 'Terrain', hint: 'Relief and elevation' },
]

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

  const source = computed<BasemapSource>(() => ({
    provider: config.public.basemap.provider as BasemapSource['provider'],
    pmtilesUrl: config.public.basemap.pmtilesUrl,
    terrainUrl: config.public.basemap.terrainUrl,
  }))

  const isDark = computed(() => colorMode.value === 'dark')

  const currentStyle = computed(() =>
    buildBasemapStyle({ view: view.value, isDark: isDark.value, source: source.value }),
  )

  const setView = (next: BasemapView): void => {
    view.value = next
  }

  return { view, setView, currentStyle, isDark, availableViews: BASEMAP_VIEWS }
}
