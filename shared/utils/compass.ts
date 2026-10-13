/**
 * Which way a phone is facing, from the three angles the browser reports.
 *
 * Pure and framework-free so it can be tested with synthetic readings; the
 * sensor plumbing (permission, listeners, throttling) is `useCompassHeading`.
 *
 * Angles follow the W3C DeviceOrientation convention: `alpha` is rotation about
 * the vertical (counter-clockwise, 0 when the device's top edge points at the
 * reference north), `beta` is front-to-back tilt (0 flat, 90 upright), `gamma`
 * is left-to-right roll. The result is a compass bearing: degrees clockwise
 * from north, 0 up to but not including 360.
 */

export interface OrientationReading {
  alpha: number | null
  beta: number | null
  gamma: number | null
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180
const toDegrees = (radians: number): number => (radians * 180) / Math.PI

export const normaliseDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360

/** The signed turn from one bearing to another by the short way, in (-180, 180]. */
export const shortestAngleDelta = (from: number, to: number): number => {
  const delta = normaliseDegrees(to - from)
  return delta > 180 ? delta - 360 : delta
}

/**
 * One step of an exponential low-pass filter on a circular quantity. Averaging
 * 359° and 1° arithmetically gives 180°; stepping by the short-way delta gives
 * 0°, which is why this is not `previous + (next - previous) * weight`.
 */
export const smoothHeading = (previous: number | null, next: number, weight: number): number => {
  if (previous === null) return normaliseDegrees(next)
  return normaliseDegrees(previous + shortestAngleDelta(previous, next) * weight)
}

/**
 * The direction the reader is facing, read off the device's attitude.
 *
 * A phone is used in two ways while walking and a compass has to cope with
 * both: held flat like a tray (the top edge points the way), and held upright
 * in front of the face (the back points the way, and the top edge points at the
 * sky, where it has no horizontal direction at all). The attitude fixes both
 * vectors; whichever lies more nearly in the horizontal plane is the one with a
 * direction worth reading. At 45° of tilt with no roll they coincide, so the
 * switch does not jump.
 *
 * `screenAngle` is `screen.orientation.angle`. Turning the phone to landscape
 * turns its top edge a quarter-turn away from the reader's line of sight, so
 * the top-edge reading is corrected by it. The back-facing reading is not: the
 * back points the same way however the phone is rotated about it.
 *
 * Returns `null` when the attitude is incomplete — some browsers report nulls
 * until the sensors have settled, and a guess would turn the map at random.
 */
export const headingFromOrientation = (
  reading: OrientationReading,
  screenAngle = 0,
): number | null => {
  const { alpha, beta, gamma } = reading
  if (alpha === null || beta === null || gamma === null) return null
  if (![alpha, beta, gamma].every(Number.isFinite)) return null

  const sinAlpha = Math.sin(toRadians(alpha))
  const cosAlpha = Math.cos(toRadians(alpha))
  const sinBeta = Math.sin(toRadians(beta))
  const cosBeta = Math.cos(toRadians(beta))
  const sinGamma = Math.sin(toRadians(gamma))
  const cosGamma = Math.cos(toRadians(gamma))

  // The device's top edge and its back (-z), as east/north components of the
  // rotation matrix Rz(alpha) · Rx(beta) · Ry(gamma).
  const topEast = -sinAlpha * cosBeta
  const topNorth = cosAlpha * cosBeta
  const backEast = -(cosAlpha * sinGamma + sinAlpha * sinBeta * cosGamma)
  const backNorth = cosAlpha * sinBeta * cosGamma - sinAlpha * sinGamma

  const topReach = Math.hypot(topEast, topNorth)
  const backReach = Math.hypot(backEast, backNorth)

  if (topReach >= backReach) {
    return normaliseDegrees(toDegrees(Math.atan2(topEast, topNorth)) + screenAngle)
  }
  return normaliseDegrees(toDegrees(Math.atan2(backEast, backNorth)))
}
