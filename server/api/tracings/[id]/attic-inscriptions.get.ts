import { z } from 'zod'
import type { NearbyAtticInscription } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/** Lazy-loaded, same shape as `/api/tracings/:id/inscriptions`. */
defineRouteMeta({
  openAPI: {
    tags: ['tracings', 'inscriptions'],
    summary: 'Attic Inscriptions Online records found near a tracing',
  },
})

export default defineEventHandler(async (event): Promise<NearbyAtticInscription[]> => {
  await enforceRateLimit(event, 'enrichment')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  return findAtticInscriptionsNearTracing(id)
})
