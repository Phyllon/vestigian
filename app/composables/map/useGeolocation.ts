import type { DevicePosition, GeolocationStatus } from '#shared/types'

/**
 * Live device position. High accuracy is requested only while the map is
 * following the user, because continuous GPS is the single largest battery
 * cost in a field application.
 */
export const useGeolocation = () => {
  const status = ref<GeolocationStatus>('idle')
  const position = ref<DevicePosition | null>(null)
  const isFollowing = ref(false)
  const errorMessage = ref<string | null>(null)

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
    errorMessage.value = null
  }

  const handleFailure = (failure: GeolocationPositionError): void => {
    if (failure.code === failure.PERMISSION_DENIED) {
      status.value = 'denied'
      errorMessage.value = 'Location is blocked. Allow it in your browser settings to use this.'
      return
    }
    status.value = 'unavailable'
    errorMessage.value =
      failure.code === failure.TIMEOUT
        ? 'No fix yet. Move somewhere with a clearer view of the sky.'
        : 'Location is unavailable on this device right now.'
  }

  const startWatching = (highAccuracy: boolean): void => {
    if (!isSupported()) {
      status.value = 'unavailable'
      errorMessage.value = 'Location needs a secure connection and a device with GPS.'
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

  /** Off → locate once → follow → off. One button, three states. */
  const toggleFollow = (): void => {
    if (status.value === 'denied') return
    if (isFollowing.value) {
      isFollowing.value = false
      startWatching(false)
      status.value = position.value ? 'locating' : 'prompting'
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
    errorMessage: readonly(errorMessage),
    toggleFollow,
    stop,
  }
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
): GeoJSON.Feature<GeoJSON.Polygon> => {
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
