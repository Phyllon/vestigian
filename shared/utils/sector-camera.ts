import type { BoundingBox, LonLat } from '../types'

/**
 * An approximate camera for a frontier sector — enough for the URL's `#map=`
 * hash, which is what a reader copies, and for the first frame. The map itself
 * is framed with `fitBounds` and `sectorFitPadding` once it exists, because
 * only it knows the real viewport and the real panel; this estimate was visibly
 * off when it was all the sector page used.
 *
 * A fixed zoom (the features page uses 8 for the Raetian Limes) would frame
 * Hadrian's Wall and cut the Danube in half, so the zoom is derived from the
 * sector's bounding box instead. MapLibre's world is `512 * 2^zoom` pixels
 * wide; the sector must fit a nominal 700 px of it, which is deliberately
 * narrower than a desktop map and wider than a phone — the sector's sheet and
 * the controls take part of the screen on either, and a sector slightly
 * smaller than the viewport is better than one that runs off it.
 *
 * The latitude span is stretched by `1 / cos(latitude)` because Web Mercator
 * does, and a north–south frontier (the Rhine's lower course, the Euphrates)
 * would otherwise be framed too tight.
 */
const NOMINAL_VIEWPORT_PIXELS = 700
const WORLD_PIXELS_AT_ZOOM_ZERO = 512
const MINIMUM_ZOOM = 4
const MAXIMUM_ZOOM = 11

export interface SectorCamera {
  center: LonLat
  zoom: number
}

export const cameraForSectorBounds = (bounds: BoundingBox): SectorCamera => {
  const center: LonLat = {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  }

  const longitudeSpan = Math.max(bounds.east - bounds.west, 0.01)
  const latitudeSpan = Math.max(bounds.north - bounds.south, 0.01)
  const stretchedLatitudeSpan = latitudeSpan / Math.cos((center.lat * Math.PI) / 180)
  const span = Math.max(longitudeSpan, stretchedLatitudeSpan)

  const fittingZoom = Math.log2(
    (NOMINAL_VIEWPORT_PIXELS * 360) / (WORLD_PIXELS_AT_ZOOM_ZERO * span),
  )
  const zoom = Math.min(MAXIMUM_ZOOM, Math.max(MINIMUM_ZOOM, fittingZoom))

  return { center, zoom: Math.floor(zoom * 2) / 2 }
}

interface SectorFitPaddingOptions {
  /** A handheld, where the sector's sheet rises over the bottom of the map. */
  isCompact: boolean
  mapHeight: number
}

/**
 * Padding that frames a sector in the part of the map its own panel leaves
 * visible: a bottom sheet of about 58% on a phone, a 384 px column at the left
 * on a wide screen. MapLibre fits to the whole container, so a plain number put
 * the Rhine behind the sheet. Shared by the panel's own list, which fits on a
 * tap, and by the map when a page asks for a sector (`MapFocusRequest.bounds`),
 * so both land on the same frame.
 */
export const sectorFitPadding = ({ isCompact, mapHeight }: SectorFitPaddingOptions) =>
  isCompact
    ? { top: 24, right: 24, bottom: Math.round(mapHeight * 0.58) + 16, left: 24 }
    : { top: 32, right: 32, bottom: 32, left: 384 }
