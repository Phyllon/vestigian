import { Map as MapLibreMap } from 'maplibre-gl'
import type { LngLatLike, StyleSpecification } from 'maplibre-gl'
import type { CameraState, LonLat } from '#shared/types'

const MAP_INJECTION_KEY = Symbol('vestigia-map') as InjectionKey<Ref<MapLibreMap | null>>

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
