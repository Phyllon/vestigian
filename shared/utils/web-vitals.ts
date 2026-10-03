/**
 * Which browser timings the app records, and how each is rated.
 *
 * The first five are the standard Web Vitals with Google's published
 * thresholds (web.dev/articles/vitals): good up to the first number, poor
 * above the second. The two `map-*` entries are this app's own — milliseconds
 * from navigation start to MapLibre's `load` (a usable canvas) and to its first
 * `idle` (every visible tile drawn) — with thresholds that are a judgement
 * rather than a standard: a phone on a fair connection should be drawing the
 * first sheet within about three seconds.
 *
 * Shared because the browser decides what to report and the server decides
 * what to believe: the server rates the number itself instead of trusting a
 * rating the client sent.
 */
export const VITAL_NAMES = ['LCP', 'FCP', 'TTFB', 'INP', 'CLS', 'map-load', 'map-idle'] as const

export type VitalName = (typeof VITAL_NAMES)[number]
export type VitalRating = 'good' | 'needs-improvement' | 'poor'
export type VitalDevice = 'compact' | 'wide'

interface VitalThresholds {
  good: number
  poor: number
}

/** Milliseconds for everything but CLS, which is a unitless score. */
export const VITAL_THRESHOLDS: Record<VitalName, VitalThresholds> = {
  LCP: { good: 2500, poor: 4000 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  'map-load': { good: 3000, poor: 6000 },
  'map-idle': { good: 5000, poor: 10_000 },
}

/** Past this a number is a stalled tab or a bad clock, not a measurement. */
export const MAXIMUM_VITAL_VALUE: Record<VitalName, number> = {
  LCP: 60_000,
  FCP: 60_000,
  TTFB: 60_000,
  INP: 60_000,
  CLS: 20,
  'map-load': 120_000,
  'map-idle': 120_000,
}

export interface VitalReport {
  name: VitalName
  value: number
  device: VitalDevice
}

export const rateVital = (name: VitalName, value: number): VitalRating => {
  const thresholds = VITAL_THRESHOLDS[name]
  if (value <= thresholds.good) return 'good'
  if (value <= thresholds.poor) return 'needs-improvement'
  return 'poor'
}
