import { z } from 'zod'
import type { IsicilyInscriptionDetail } from '#shared/types'

export const paramsSchema = z.object({ isicilyId: z.string().regex(/^ISic\d{1,8}$/) })

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Get one I.Sicily inscription by its identifier',
    description:
      'Text and metadata from I.Sicily (CC BY 4.0; six records CC BY-NC 4.0, stated per record). Photographs are not served — they are not licensed for reuse.',
  },
})

export default defineEventHandler(async (event): Promise<IsicilyInscriptionDetail> => {
  await enforceRateLimit(event, 'record')
  const { isicilyId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const inscription = await loadIsicilyInscriptionDetail(isicilyId)
  if (!inscription) {
    throw createError({ statusCode: 404, message: 'No I.Sicily inscription with that identifier.' })
  }

  return inscription
})
