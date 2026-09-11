import { z } from 'zod'
import type { NearbyAtticInscription } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * Lazy-loaded, same shape as `/api/sites/:id/inscriptions` — the same
 * cross-referencing synergy, reused for the second, smaller AIO corpus.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites', 'inscriptions'],
    summary: 'Attic Inscriptions Online records found near a site',
  },
})

export default defineEventHandler(async (event): Promise<NearbyAtticInscription[]> => {
  await enforceRateLimit(event, 'enrichment')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  return findAtticInscriptionsNearSite(id)
})
