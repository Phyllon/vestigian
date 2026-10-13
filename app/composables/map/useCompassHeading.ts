import {
  headingFromOrientation,
  normaliseDegrees,
  shortestAngleDelta,
  smoothHeading,
} from '#shared/utils/compass'

export type CompassStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable'

/**
 * Event data stamped on every camera move this feature makes (`easeTo`'s second
 * argument is merged into the events it fires). Anything that treats a move as
 * the reader's own must let these through: following the position must not end
 * because the map turned, the address bar must not be rewritten eight times a
 * second (Safari refuses more than 100 `replaceState` calls in 30 s), and the
 * featured list must not refetch because only the bearing changed.
 */
export const COMPASS_MOVE_FLAG = 'compassHeading'

interface CompassOrientationEvent extends DeviceOrientationEvent {
  /** iOS Safari only: degrees clockwise from north, already tilt-compensated. */
  webkitCompassHeading?: number
  /** iOS Safari only: negative when the reading is not valid. */
  webkitCompassAccuracy?: number
}

interface OrientationPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/** Weight of each new reading in the running average; lower is steadier and slower. */
const SMOOTHING_WEIGHT = 0.25
/** At most this often, so the map redraws about seven times a second while turning. */
const EMIT_INTERVAL_MS = 150
/** Below this the map stays put: a phone in a hand is never perfectly still. */
const MIN_CHANGE_DEGREES = 1.5
/** A phone with no usable compass sends nothing, or sends relative angles. */
const NO_READING_TIMEOUT_MS = 3000

/**
 * The direction the reader's phone is facing, as a compass bearing, for turning
 * the map to match it. Nothing leaves the device and nothing is stored: the
 * readings are used to set the map's bearing and discarded.
 *
 * - **Permission.** iOS 13+ asks, and only from a tap, so `start()` must be
 *   called straight from a click handler. Android Chrome needs none.
 * - **Which event.** Android Chrome's plain `deviceorientation` is relative to
 *   wherever the phone happened to be pointing when the page opened, which is
 *   not north; `deviceorientationabsolute` is. iOS has no absolute event and
 *   supplies `webkitCompassHeading` on the plain one instead. A reading that is
 *   neither is discarded rather than turned into a wrong north.
 * - **North is magnetic.** Both platforms report magnetic north. Across Europe
 *   declination runs from about −1° to +10° east, which is below what a walker
 *   steering by a map notices; it is not corrected, because that needs a
 *   world magnetic model shipped to every phone for a few degrees.
 * - **Support is a guess until it is not.** Having `DeviceOrientationEvent` and
 *   a coarse pointer says "a phone", not "a phone with a magnetometer"; the
 *   timeout is what turns a silent sensor into a message.
 */
export const useCompassHeading = () => {
  const status = ref<CompassStatus>('idle')
  const heading = ref<number | null>(null)
  const isSupported = ref(false)

  let smoothed: number | null = null
  let lastEmittedAt = 0
  let timeoutId: number | undefined
  let listeningFor: 'deviceorientation' | 'deviceorientationabsolute' | null = null

  /** Called once mounted: `window` and `matchMedia` do not exist during SSR. */
  const refreshSupport = (): void => {
    isSupported.value =
      'DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches
  }

  const screenAngle = (): number => window.screen.orientation?.angle ?? 0

  const readHeading = (event: CompassOrientationEvent): number | null => {
    const { webkitCompassHeading, webkitCompassAccuracy } = event
    if (typeof webkitCompassHeading === 'number' && Number.isFinite(webkitCompassHeading)) {
      if (typeof webkitCompassAccuracy === 'number' && webkitCompassAccuracy < 0) return null
      return normaliseDegrees(webkitCompassHeading + screenAngle())
    }

    const isAbsolute = listeningFor === 'deviceorientationabsolute' || event.absolute === true
    if (!isAbsolute) return null

    return headingFromOrientation(
      { alpha: event.alpha, beta: event.beta, gamma: event.gamma },
      screenAngle(),
    )
  }

  const handleOrientation = (event: Event): void => {
    const raw = readHeading(event as CompassOrientationEvent)
    if (raw === null) return

    window.clearTimeout(timeoutId)
    status.value = 'active'
    smoothed = smoothHeading(smoothed, raw, SMOOTHING_WEIGHT)

    const now = performance.now()
    if (now - lastEmittedAt < EMIT_INTERVAL_MS) return
    if (
      heading.value !== null &&
      Math.abs(shortestAngleDelta(heading.value, smoothed)) < MIN_CHANGE_DEGREES
    ) {
      return
    }
    lastEmittedAt = now
    heading.value = smoothed
  }

  const stop = (finalStatus: CompassStatus = 'idle'): void => {
    if (listeningFor) window.removeEventListener(listeningFor, handleOrientation)
    listeningFor = null
    window.clearTimeout(timeoutId)
    smoothed = null
    heading.value = null
    status.value = finalStatus
  }

  const start = async (): Promise<void> => {
    if (status.value === 'requesting' || status.value === 'active') return
    status.value = 'requesting'

    const permission = DeviceOrientationEvent as unknown as OrientationPermissionApi
    if (typeof permission.requestPermission === 'function') {
      try {
        if ((await permission.requestPermission()) !== 'granted') {
          stop('denied')
          return
        }
      } catch {
        stop('denied')
        return
      }
    }

    listeningFor =
      'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(listeningFor, handleOrientation)
    timeoutId = window.setTimeout(() => stop('unavailable'), NO_READING_TIMEOUT_MS)
  }

  onBeforeUnmount(() => stop())

  return {
    status: readonly(status),
    heading: readonly(heading),
    isSupported: readonly(isSupported),
    refreshSupport,
    start,
    stop,
  }
}
