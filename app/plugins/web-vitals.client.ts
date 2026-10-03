/**
 * Real-user performance, reported anonymously — see `server/api/vitals.post.ts`
 * for what is and is not kept. Skipped outright when the browser says Do Not
 * Track or Global Privacy Control, and in development, where the numbers
 * describe a dev server.
 *
 * `web-vitals` (Apache-2.0, Google Chrome team) is imported dynamically after
 * the page is idle, so it is never part of what the first paint waits for.
 */
export default defineNuxtPlugin(() => {
  if (import.meta.dev || isMeasurementDeclined()) return

  const send = (): void => flushVitals()

  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send()
  })
  addEventListener('pagehide', send)

  const start = async (): Promise<void> => {
    const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals')
    const report = (metric: { name: string; value: number }): void => {
      queueVital(metric.name as Parameters<typeof queueVital>[0], metric.value)
    }
    onLCP(report)
    onFCP(report)
    onTTFB(report)
    onINP(report)
    onCLS(report)
  }

  if ('requestIdleCallback' in window) requestIdleCallback(() => void start())
  else setTimeout(() => void start(), 2000)
})
