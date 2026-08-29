import type { LonLat } from './site'

/**
 * The views offered by the basemap switcher, in two families. The first three
 * are recolourings of one modern vector source: 'vestigia' suppresses modern
 * infrastructure, 'modern' is a conventional road map, 'terrain' adds
 * hillshade. The two 'antiquity-*' views replace that source outright with a
 * raster reconstruction of the ancient world.
 */
export type BasemapView = 'vestigia' | 'modern' | 'terrain' | 'antiquity-dare' | 'antiquity-awmc'

export type BasemapProvider = 'openfreemap' | 'pmtiles'

/**
 * Which half of the switcher an option belongs to. Five flat entries read as a
 * list to be worked through; two named groups say what the choice is actually
 * between — the ground as it is now, or the ground as it was.
 */
export type BasemapGroup = 'today' | 'antiquity'

export interface BasemapOption {
  value: BasemapView
  group: BasemapGroup
  label: string
  hint: string
}

/**
 * Whether the sheet under the site overlay is light or dark. Not the same as
 * the colour scheme: an antiquity raster is printed parchment in either theme,
 * so the markers drawn on top of it have to stay dark ink even at night.
 */
export type BasemapSheetTone = 'light' | 'dark'

export interface BasemapSource {
  provider: BasemapProvider
  pmtilesUrl: string
  terrainUrl: string
  antiquityDareUrl: string
  atlasTilesUrl: string
  glyphsUrl: string
}

export interface CameraState {
  center: LonLat
  zoom: number
  bearing: number
  pitch: number
}

export type GeolocationStatus =
  'idle' | 'prompting' | 'locating' | 'tracking' | 'denied' | 'unavailable'

export interface DevicePosition {
  coords: LonLat
  accuracy: number
  heading: number | null
  timestamp: number
}

/** Which geometry the map serves at a given zoom. */
export type TileStrategy = 'cluster' | 'feature'

export interface TileRenderPlan {
  strategy: TileStrategy
  simplifyTolerance: number
  clusterGridSize: number
  includeTracings: boolean
}
