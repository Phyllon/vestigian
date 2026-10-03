import { z } from 'zod'
import {
  MAXIMUM_VITAL_VALUE,
  VITAL_NAMES,
  rateVital,
  type VitalReport,
} from '#shared/utils/web-vitals'

const reportSchema = z.object({
  name: z.enum(VITAL_NAMES),
  value: z.number().finite().nonnegative(),
  device: z.enum(['compact', 'wide']),
})

/** A page load produces at most one of each; the cap is for the batch, not a quota. */
const bodySchema = z
  .array(reportSchema)
  .min(1)
  .max(VITAL_NAMES.length * 2)

/**
 * Anonymous real-user timings from the browser, folded straight into
 * histograms (`web_vital_*` in `server/utils/metrics.ts`).
 *
 * Nothing about the sender is kept: not the address, user agent, route,
 * session or a device identifier — the request is counted and discarded, so
 * the only trace is a bucket increment. `204` always, even for values refused
 * as implausible, so the endpoint tells a caller nothing about what it keeps.
 * The browser side declines to send at all under Do-Not-Track or Global
 * Privacy Control (`app/plugins/web-vitals.client.ts`).
 */
defineRouteMeta({
  openAPI: {
    tags: ['system'],
    summary: 'Report anonymous browser timings',
    description:
      'Takes a small batch of Web Vitals and map-load timings from the browser and records them as aggregate histograms. No identifier, address or user agent is stored.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'vitals')
  const reports: VitalReport[] = await readValidatedBody(event, bodySchema.parse)

  for (const report of reports) {
    if (report.value > MAXIMUM_VITAL_VALUE[report.name]) continue

    webVitalRatingsTotal().inc({ name: report.name, rating: rateVital(report.name, report.value) })

    if (report.name === 'CLS') {
      webVitalLayoutShift().observe({ device: report.device }, report.value)
    } else {
      webVitalDuration().observe({ name: report.name, device: report.device }, report.value / 1000)
    }
  }

  setResponseStatus(event, 204)
  return null
})
