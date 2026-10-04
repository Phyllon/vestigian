import { Popup } from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

export const SELECTION_RING_SOURCE_ID = 'vestigian-overlay-selection'
export const SELECTION_RING_LAYER_ID = 'vestigian-overlay-selection-ring'

type Position = [number, number]

/** The same two tones a selected site's halo uses (`useViewportTiles`), light sheet and night sheet. */
const LIGHT_RING_COLOUR = '#9a3b22'
const DARK_RING_COLOUR = '#d38a72'

interface OverlaySelection {
  popup: Popup
  /** `null` for a popup that has no icon to ring — a line, or a realm's name. */
  position: Position | null
}

const selectionByMap = new WeakMap<MapLibreMap, OverlaySelection>()
const mapsKeepingRing = new WeakSet<MapLibreMap>()

const ringData = (position: Position | null): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features:
    position === null
      ? []
      : [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: position } }],
})

export interface OverlayPopupRequest {
  map: MapLibreMap
  position: Position
  html: string
  maxWidth: string
  /** Ring the icon the popup belongs to, as a selected site is. Off for lines and areas. */
  withRing?: boolean
}

/**
 * Every reference overlay's popup opens through here, so a clicked icon is marked
 * the way a clicked site is — a ring around it, in the one oxide accent — and the
 * ring goes when the popup does.
 *
 * Not a feature-state ring like the sites': those come from one vector source the
 * app owns, while these icons live in a dozen sources of their own, so the ring is
 * its own one-point GeoJSON source, drawn above them. Its fill is faint enough
 * that the icon underneath still reads.
 *
 * **Which popup owns the ring is tracked, because MapLibre closes the old popup on
 * the very click that opens the new one** (`closeOnClick`), and the close event of
 * the old one arrives after the new one has set its ring. Clearing on every close
 * would wipe the ring the moment it was drawn; clearing only for the popup that
 * still owns it does not.
 *
 * A style swap (basemap or theme) removes custom sources, so the ring is put back
 * from `styledata`, in the tone the sheet now wants.
 */
export const useOverlayPopup = () => {
  const { sheetTone } = useBasemapStyle()

  const ringColour = (): string =>
    sheetTone.value === 'dark' ? DARK_RING_COLOUR : LIGHT_RING_COLOUR

  const paintRing = (map: MapLibreMap): void => {
    const position = selectionByMap.get(map)?.position ?? null
    const source = map.getSource(SELECTION_RING_SOURCE_ID) as GeoJSONSource | undefined

    if (source) {
      source.setData(ringData(position))
      return
    }
    if (position === null) return

    const colour = ringColour()
    map.addSource(SELECTION_RING_SOURCE_ID, { type: 'geojson', data: ringData(position) })
    map.addLayer({
      id: SELECTION_RING_LAYER_ID,
      type: 'circle',
      source: SELECTION_RING_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 16, 8, 25, 14, 31],
        'circle-color': colour,
        'circle-opacity': 0.16,
        'circle-stroke-color': colour,
        'circle-stroke-width': 2,
        'circle-pitch-alignment': 'map',
      },
    })
  }

  const keepRingThroughStyleChanges = (map: MapLibreMap): void => {
    if (mapsKeepingRing.has(map)) return
    mapsKeepingRing.add(map)
    map.on('styledata', () => {
      if (selectionByMap.get(map)?.position && !map.getSource(SELECTION_RING_SOURCE_ID)) {
        paintRing(map)
      }
    })
  }

  const openOverlayPopup = (request: OverlayPopupRequest): Popup => {
    const { map, position, html, maxWidth, withRing = true } = request

    const popup = new Popup({ closeButton: true, maxWidth })
      .setLngLat(position)
      .setHTML(html)
      .addTo(map)

    selectionByMap.set(map, { popup, position: withRing ? position : null })
    keepRingThroughStyleChanges(map)
    paintRing(map)

    popup.on('close', () => {
      if (selectionByMap.get(map)?.popup !== popup) return
      selectionByMap.set(map, { popup, position: null })
      paintRing(map)
    })

    return popup
  }

  return { openOverlayPopup }
}
