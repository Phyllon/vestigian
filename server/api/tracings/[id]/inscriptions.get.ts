import { z } from 'zod'
import type { NearbyInscription } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * Lazy-loaded, same shape as `/api/sites/:id/inscriptions` — a tighter
 * search radius than the site version, since a milestone genuinely sits on
 * or beside the road it names (see `server/utils/inscriptions.ts`).
 */
defineRouteMeta({
  openAPI: {
    tags: ['tracings', 'inscriptions'],
    summary: 'Mirrored EDH inscriptions found near a tracing',
  },
})

export default defineEventHandler(async (event): Promise<NearbyInscription[]> => {
  await enforceRateLimit(event, 'enrichment')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  return findInscriptionsNearTracing(id)
})
