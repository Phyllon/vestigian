import type { AncientPlaceSummary, LonLat, PlaceSummary, SiteSummary } from './site'

/**
 * The views offered by the basemap switcher, in two families. 'vestigian' is a
 * recolouring of one modern vector source, with modern infrastructure pushed
 * to the background. 'satellite' is Sentinel-2 imagery — real photography, not
 * a stylised recolouring, which is why it is raster rather than another take on
 * the same vector source. The two 'antiquity-*' views replace the vector source
 * outright with a reconstruction of the ancient world.
 *
 * There was a 'modern' view, a conventional full-opacity road map — dropped
 * because a recolouring of the same OpenStreetMap data one slider-click away
 * from 'vestigian' was not different enough to earn a second entry in the
 * switcher; 'satellite' replaced it with an actually distinct way of looking at
 * the ground. There was also a third modern view, 'terrain', which was the
 * 'vestigian' palette with one hillshade layer spliced in. It was removed
 * rather than kept: the same elevation source does better work as
 * `atlas-hillshade` under the Barrington sheet, so the relief it offered is
 * still on the map and the option was only a fourth way to look at the same
 * roads. `BasemapSource.terrainUrl` stays for that reason — the tiles are
 * still fetched, just not by a view.
 */
export type BasemapView = 'vestigian' | 'satellite' | 'antiquity-dare' | 'antiquity-awmc'

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
  /** The mirrored Sentinel-2 cloudless pyramid. Empty means "ask EOX directly". */
  satelliteUrl: string
  atlasTilesUrl: string
  /** The frontier layers, added to the Barrington sheet when it is switched on. */
  limesTilesUrl: string
  /** The empire's extent at one of three dates, added when the period scrubber is set. */
  empireExtentTilesUrl: string
  /** Ancient battles worldwide, added to any basemap when "Show battles" is on. */
  battleTilesUrl: string
  /** Ancient ports and harbours worldwide, added when "Show ports" is on. */
  portTilesUrl: string
  /** The ORBIS route network, added when "Show ancient routes" is on. */
  routeTilesUrl: string
  /** AWMC's minor point features, added when "Show minor antiquities" is on. */
  featureTilesUrl: string
  /** CHRR coin-hoard findspots, added when "Show coin hoards" is on. */
  coinHoardTilesUrl: string
  /** Mirrored EDH inscriptions with a resolved findspot, added when "Show inscriptions" is on. */
  inscriptionTilesUrl: string
  /** Attic Inscriptions Online with a resolved findspot, added when "Show Attic inscriptions" is on. */
  atticInscriptionTilesUrl: string
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
export type MapSearchResult =
  | ({ kind: 'site' } & SiteSummary)
  | ({ kind: 'place' } & PlaceSummary)
  | ({ kind: 'ancient-place' } & AncientPlaceSummary)
