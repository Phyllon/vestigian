import type { DevicePosition, GeolocationStatus } from '#shared/types'

export type GeolocationErrorCode = 'denied' | 'timeout' | 'unavailable' | 'insecureContext'

/**
 * Live device position. High accuracy is requested only while the map is
 * following the user, because continuous GPS is the single largest battery
 * cost in a field application.
 *
 * `errorCode` rather than a message string — a composable has no guaranteed
 * i18n context, so `GeolocateButton.vue` maps the code to translated text.
 */
export const useGeolocation = () => {
  const status = ref<GeolocationStatus>('idle')
  const position = ref<DevicePosition | null>(null)
  const isFollowing = ref(false)
  const errorCode = ref<GeolocationErrorCode | null>(null)

  let watchId: number | null = null

  const isSupported = (): boolean =>
    import.meta.client && 'geolocation' in navigator && window.isSecureContext

  const handleSuccess = (reading: GeolocationPosition): void => {
    position.value = {
      coords: { lon: reading.coords.longitude, lat: reading.coords.latitude },
      accuracy: reading.coords.accuracy,
      heading: Number.isFinite(reading.coords.heading) ? reading.coords.heading : null,
      timestamp: reading.timestamp,
    }
    status.value = isFollowing.value ? 'tracking' : 'locating'
    errorCode.value = null
  }

  const handleFailure = (failure: GeolocationPositionError): void => {
    if (failure.code === failure.PERMISSION_DENIED) {
      status.value = 'denied'
      errorCode.value = 'denied'
      return
    }
    status.value = 'unavailable'
    errorCode.value = failure.code === failure.TIMEOUT ? 'timeout' : 'unavailable'
  }

  const startWatching = (highAccuracy: boolean): void => {
    if (!isSupported()) {
      status.value = 'unavailable'
      errorCode.value = 'insecureContext'
      return
    }
    stopWatching()
    status.value = 'prompting'
    watchId = navigator.geolocation.watchPosition(handleSuccess, handleFailure, {
      enableHighAccuracy: highAccuracy,
      maximumAge: highAccuracy ? 1000 : 15000,
      timeout: 20000,
    })
  }

  const stopWatching = (): void => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
  }

  /**
   * Leaves follow mode but keeps the marker on the map. Called by the button
   * and by `GeolocateButton` when the person pans away — without the latter
   * every fix re-centred the map and made it impossible to look elsewhere.
   */
  const releaseFollow = (): void => {
    if (!isFollowing.value) return
    isFollowing.value = false
    startWatching(false)
    status.value = position.value ? 'locating' : 'prompting'
  }

  /** Off → locate once → follow → off. One button, three states. */
  const toggleFollow = (): void => {
    if (status.value === 'denied') return
    if (isFollowing.value) {
      releaseFollow()
      return
    }
    isFollowing.value = true
    startWatching(true)
  }

  const stop = (): void => {
    isFollowing.value = false
    stopWatching()
    status.value = 'idle'
  }

  onBeforeUnmount(() => {
    stopWatching()
  })

  return {
    status: readonly(status),
    position: readonly(position),
    isFollowing: readonly(isFollowing),
    errorCode: readonly(errorCode),
    toggleFollow,
    releaseFollow,
    stop,
  }
}

/**
 * A polygon that remembers its ring positions are `[lon, lat]` pairs.
 *
 * `GeoJSON.Polygon` types coordinates as `Position[][]`, and `Position` is
 * `number[]` — a length the type system does not know. Returning the plain
 * type therefore discards what this function certainly knows, and every reader
 * has to assert it back. Narrowing here instead keeps callers, and the tests,
 * free of assertions; it is still a `Feature<Polygon>` wherever one is wanted,
 * because a `[number, number][][]` is a `Position[][]`.
 */
export interface AccuracyCircle {
  type: 'Feature'
  properties: GeoJSON.GeoJsonProperties
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

/**
 * The accuracy halo is drawn as a real geographic circle rather than a fixed
 * pixel radius, so it stays truthful about precision at every zoom. Latitude
 * correction matters: at 60°N a degree of longitude is half its equatorial
 * length, and an uncorrected circle would be visibly egg-shaped.
 */
export const buildAccuracyCircle = (
  centre: { lon: number; lat: number },
  radiusMetres: number,
  steps = 64,
): AccuracyCircle => {
  const latitudeRadius = radiusMetres / 111320
  const longitudeRadius = latitudeRadius / Math.cos((centre.lat * Math.PI) / 180)
  const ring: [number, number][] = []

  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2
    ring.push([
      centre.lon + longitudeRadius * Math.cos(angle),
      centre.lat + latitudeRadius * Math.sin(angle),
    ])
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}
