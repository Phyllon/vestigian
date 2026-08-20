import type { LonLat } from './site'

/**
 * The three views offered by the basemap switcher. 'vestigia' suppresses modern
 * infrastructure, 'modern' is a conventional road map, 'terrain' adds hillshade.
 */
export type BasemapView = 'vestigia' | 'modern' | 'terrain'

export type BasemapProvider = 'openfreemap' | 'pmtiles'

export interface BasemapSource {
  provider: BasemapProvider
  pmtilesUrl: string
  terrainUrl: string
}

export interface CameraState {
  center: LonLat
  zoom: number
  bearing: number
  pitch: number
}

export type GeolocationStatus =
  | 'idle'
  | 'prompting'
  | 'locating'
  | 'tracking'
  | 'denied'
  | 'unavailable'

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
