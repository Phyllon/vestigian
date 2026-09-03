import type { LonLat, PlaceSummary, SiteSummary } from './site'

/**
 * The views offered by the basemap switcher, in two families. The first two are
 * recolourings of one modern vector source: 'vestigian' suppresses modern
 * infrastructure, 'modern' is a conventional road map. The two 'antiquity-*'
 * views replace that source outright with a reconstruction of the ancient world.
 *
 * There was a third modern view, 'terrain', which was the 'vestigian' palette
 * with one hillshade layer spliced in. It was removed rather than kept: the
 * same elevation source does better work as `atlas-hillshade` under the
 * Barrington sheet, so the relief it offered is still on the map and the option
 * was only a fourth way to look at the same roads. `BasemapSource.terrainUrl`
 * stays for that reason — the tiles are still fetched, just not by a view.
 */
export type BasemapView = 'vestigian' | 'modern' | 'antiquity-dare' | 'antiquity-awmc'

export type BasemapProvider = 'openfreemap' | 'pmtiles'

/**
 * Which half of the switcher an option belongs to. Four flat entries read as a
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
  /** The frontier layers, added to the Barrington sheet when it is switched on. */
  limesTilesUrl: string
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

/**
 * One combined result list for the map search bar, covering both what the
 * atlas records (`site`) and where a reader might simply want to navigate to
 * (`place`, a modern city or town — see `PlaceSummary`). A discriminated
 * union rather than two separate lists so the field can render one ranked
 * list and the "no matches" state has one thing to be empty about.
 */
export type MapSearchResult = ({ kind: 'site' } & SiteSummary) | ({ kind: 'place' } & PlaceSummary)
