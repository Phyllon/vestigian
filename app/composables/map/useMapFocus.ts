import type { Map as MapLibreMap } from 'maplibre-gl'
import type { BoundingBox, LonLat } from '#shared/types'
import { recordSheetClearance } from '#shared/utils/record-sheet'

/**
 * A camera position asked for from a page that has no map of its own.
 *
 * The features page (and anything like it) cannot reach the map: it is not
 * under `MapCanvas`, which is what provides it. It leaves a request here and
 * navigates to `/`; the canvas takes it as soon as the map exists and moves the
 * camera before anything is drawn. `useState` survives the client-side
 * navigation — the same reason the overlay switches do.
 */
export interface MapFocusRequest {
  center: LonLat
  zoom: number
  /**
   * Frame this box instead of standing at `center`/`zoom`. The map fits it to
   * its real viewport and the sector panel's padding, which no page can
   * calculate for it; `center` and `zoom` are then only the fallback and the
   * hash.
   */
  bounds?: BoundingBox
}

export const useMapFocus = () => {
  const request = useState<MapFocusRequest | null>('map-focus-request', () => null)

  const requestFocus = (next: MapFocusRequest): void => {
    request.value = next
  }

  /** Reads and clears: a request is answered once, not on every later mount. */
  const takeRequest = (): MapFocusRequest | null => {
    const pending = request.value
    request.value = null
    return pending
  }

  return { requestFocus, takeRequest }
}

interface FocusClearOfSheetOptions {
  request: MapFocusRequest
  /** The sheet rises from the bottom (a phone) rather than standing at the side. */
  isSheetAtBottom: boolean
}

/**
 * Puts the requested point on the map in the part the record sheet leaves
 * visible — and leaves the map with no padding afterwards.
 *
 * `padding` on a camera move would do the first half, but it persists: every
 * later move (a search result, a tap on a cluster) would then be centred in a
 * region the sheet no longer covers once it is closed. So padding is used only
 * to *measure*: apply it, read which ground sits under the middle of the whole
 * viewport, then drop the padding and centre on that ground. The point lands
 * exactly where the padded move put it, and the map is left as it was.
 */
export const focusClearOfRecordSheet = (
  map: MapLibreMap,
  { request, isSheetAtBottom }: FocusClearOfSheetOptions,
): void => {
  const container = map.getContainer()
  const padding = recordSheetClearance({
    viewportHeight: window.innerHeight,
    mapHeight: container.clientHeight,
    isSheetAtBottom,
  })
  const target: [number, number] = [request.center.lon, request.center.lat]

  map.jumpTo({ center: target, zoom: request.zoom, padding })
  const underMiddle = map.unproject([container.clientWidth / 2, container.clientHeight / 2])
  map.jumpTo({
    center: underMiddle,
    zoom: request.zoom,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  })
}
