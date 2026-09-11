import { z } from 'zod'
import type { NearbyInscription } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * Lazy-loaded like `/api/sites/:id/enrichment` — a fast local query, but kept
 * off the main site payload so it stays small and cacheable regardless of
 * whether a reader ever opens this panel section.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites', 'inscriptions'],
    summary: 'Mirrored EDH inscriptions found near a site',
  },
})

export default defineEventHandler(async (event): Promise<NearbyInscription[]> => {
  await enforceRateLimit(event, 'enrichment')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  return findInscriptionsNearSite(id)
})
