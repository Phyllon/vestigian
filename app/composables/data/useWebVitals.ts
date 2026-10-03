import type { VitalName, VitalReport } from '#shared/utils/web-vitals'

/**
 * Where browser timings wait to be sent. Module state rather than `useState`:
 * this is client-only bookkeeping that must not serialise into the payload, and
 * the plugin that flushes it and the map that fills it are the same page load.
 */
const queued: VitalReport[] = []

const readDevice = (): VitalReport['device'] =>
  window.matchMedia('(min-width: 900px)').matches ? 'wide' : 'compact'

export const queueVital = (name: VitalName, value: number): void => {
  if (!Number.isFinite(value) || value < 0) return
  queued.push({ name, value: Math.round(value * 1000) / 1000, device: readDevice() })
}

/** `sendBeacon` survives the page closing, which is when most of these become final. */
export const flushVitals = (): void => {
  if (queued.length === 0) return
  const body = new Blob([JSON.stringify(queued.splice(0))], { type: 'application/json' })
  navigator.sendBeacon('/api/vitals', body)
}

/**
 * Honoured before anything is measured, not just before it is sent: Do Not
 * Track and Global Privacy Control are both an explicit "do not measure me".
 */
export const isMeasurementDeclined = (): boolean => {
  const signals = navigator as Navigator & { globalPrivacyControl?: boolean }
  return navigator.doNotTrack === '1' || signals.globalPrivacyControl === true
}
