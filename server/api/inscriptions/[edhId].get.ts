import { z } from 'zod'
import type { InscriptionDetail } from '#shared/types'

export const paramsSchema = z.object({ edhId: z.string().regex(/^HD\d+$/) })

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Get one mirrored EDH inscription by its EDH id',
  },
})

export default defineEventHandler(async (event): Promise<InscriptionDetail> => {
  await enforceRateLimit(event, 'record')
  const { edhId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const inscription = await loadInscriptionDetail(edhId)
  if (!inscription) {
    throw createError({ statusCode: 404, message: 'No mirrored inscription with that identifier.' })
  }

  return inscription
})
