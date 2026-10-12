import { Map as MapLibreMap } from 'maplibre-gl'
import type { LngLatLike, StyleSpecification } from 'maplibre-gl'
import type { CameraState, LonLat } from '#shared/types'

const MAP_INJECTION_KEY = Symbol('vestigian-map') as InjectionKey<Ref<MapLibreMap | null>>

interface MapCreationOptions {
  container: HTMLElement
  style: StyleSpecification | string
  camera: CameraState
}

/**
 * Owns the MapLibre instance. Deliberately imperative: wrapping a WebGL map in
 * reactive state means every pan re-renders the component tree, which is the
 * usual reason Vue map integrations feel sluggish. The map is created once and
 * mutated directly; only meaningful events are lifted back into Vue.
 */
export const createMapInstance = (options: MapCreationOptions): MapLibreMap => {
  const map = new MapLibreMap({
    container: options.container,
    style: options.style,
    center: [options.camera.center.lon, options.camera.center.lat] as LngLatLike,
    zoom: options.camera.zoom,
    bearing: options.camera.bearing,
    pitch: options.camera.pitch,
    maxZoom: 18,
    minZoom: 2,
    attributionControl: { compact: true },
    // Touch behaviour tuned for one-handed use in the field.
    dragRotate: false,
    pitchWithRotate: false,
    touchZoomRotate: true,
    cooperativeGestures: false,
    fadeDuration: 120,
  })

  map.touchZoomRotate.disableRotation()
  return map
}

export const provideMapInstance = (map: Ref<MapLibreMap | null>): void => {
  provide(MAP_INJECTION_KEY, map)
}

export const useMapInstance = (): Ref<MapLibreMap | null> => {
  const map = inject(MAP_INJECTION_KEY, null)
  if (!map) {
    throw new Error('useMapInstance must be called inside a component under MapCanvas.')
  }
  return map
}

/**
 * The map when there is one above this component, `null` on a reading page that
 * has none — for a control that is a convenience beside the map (a "fit the view"
 * button) and must still render where there is no map to move.
 */
export const useOptionalMapInstance = (): Ref<MapLibreMap | null> | null =>
  inject(MAP_INJECTION_KEY, null)

const DEFAULT_CAMERA: CameraState = {
  // Centred on the Alps, which puts the densest part of the data on screen at
  // the opening zoom without favouring one modern country.
  center: { lon: 10.4, lat: 45.6 },
  zoom: 5,
  bearing: 0,
  pitch: 0,
}

/**
 * Camera state survives reloads and is shareable as a URL. Written to the hash
 * rather than the query string so it never reaches the server or the cache key.
 */
export const useCameraState = () => {
  const route = useRoute()
  const camera = ref<CameraState>(DEFAULT_CAMERA)

  const readCameraFromHash = (hash: string): CameraState | null => {
    const match = /^#map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)$/.exec(hash)
    if (!match) return null
    const [, zoom, lat, lon] = match
    return {
      center: { lon: Number(lon), lat: Number(lat) },
      zoom: Number(zoom),
      bearing: 0,
      pitch: 0,
    }
  }

  const writeCameraToHash = (next: CameraState): string =>
    `#map=${next.zoom.toFixed(2)}/${next.center.lat.toFixed(5)}/${next.center.lon.toFixed(5)}`

  const restoreCamera = (): CameraState => {
    const fromHash = readCameraFromHash(route.hash)
    if (fromHash) camera.value = fromHash
    return camera.value
  }

  const rememberCamera = (next: CameraState): void => {
    camera.value = next
    history.replaceState(history.state, '', writeCameraToHash(next))
  }

  return { camera, restoreCamera, rememberCamera, readCameraFromHash, writeCameraToHash }
}

export const toLngLat = (position: LonLat): [number, number] => [position.lon, position.lat]

const mapsWithBoundOverlayListeners = new WeakMap<MapLibreMap, Set<string>>()

const clickableOverlayLayerIds = new Set<string>()

/**
 * Every layer that opens a popup when clicked. `bindOverlayListenersOnce` records
 * the ones it binds; the Pleiades place layers, which bind their own listeners,
 * call this directly.
 */
export const registerClickableOverlayLayer = (layerId: string): void => {
  clickableOverlayLayerIds.add(layerId)
}

/**
 * Whether the pointer is over something that answers a click — the cursor's one
 * source of truth. Each overlay also sets `pointer` on its own `mouseenter`, but
 * `MapCanvas`'s `mousemove` handler wrote `''` back on the very next pixel of
 * movement, because it only knew about sites; the cursor therefore flickered to a
 * pointer for one frame over every icon that is not a site. Asking one question
 * of one list here replaces that race with an answer.
 *
 * Filtered to layers that exist: `queryRenderedFeatures` throws for an unknown
 * layer id rather than returning nothing, and most of these are absent at any
 * moment (an overlay that is off has no layer).
 */
export const isOverClickableOverlay = (
  map: MapLibreMap,
  point: { x: number; y: number },
): boolean => {
  const layers = [...clickableOverlayLayerIds].filter((id) => map.getLayer(id))
  if (layers.length === 0) return false

  const box: [[number, number], [number, number]] = [
    [point.x - 6, point.y - 6],
    [point.x + 6, point.y + 6],
  ]
  return map.queryRenderedFeatures(box, { layers }).length > 0
}

/**
 * Every reference overlay's `attach*Overlay` re-runs on each `styledata`
 * event whenever its own source is missing — including right after
 * `setStyle()` on a theme switch, which wipes sources and layers but leaves
 * any `map.on(...)` listeners already bound in place (they are not part of
 * the style document). Without this guard, `attachXOverlay` registered a
 * fresh click/mouseenter/mouseleave handler on every such re-run, so a
 * single tap fired one stacked `Popup` per past style change, each needing
 * its own close click. Keyed by map instance and layer id, so a genuinely
 * new `Map` (a remount, not a style swap) still binds its own listeners.
 */
export const bindOverlayListenersOnce = (
  map: MapLibreMap,
  layerId: string,
  bind: () => void,
): void => {
  const bound = mapsWithBoundOverlayListeners.get(map) ?? new Set<string>()
  if (bound.has(layerId)) return
  registerClickableOverlayLayer(layerId)
  bind()
  bound.add(layerId)
  mapsWithBoundOverlayListeners.set(map, bound)
}
