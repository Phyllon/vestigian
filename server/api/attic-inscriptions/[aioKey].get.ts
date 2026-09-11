import { z } from 'zod'
import type { AtticInscriptionDetail } from '#shared/types'

export const paramsSchema = z.object({ aioKey: z.string().regex(/^AIO_\d+$/) })

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Get one Attic Inscriptions Online record by its AIO key',
  },
})

export default defineEventHandler(async (event): Promise<AtticInscriptionDetail> => {
  await enforceRateLimit(event, 'record')
  const { aioKey } = await getValidatedRouterParams(event, paramsSchema.parse)

  const inscription = await loadAtticInscriptionDetail(aioKey)
  if (!inscription) {
    throw createError({ statusCode: 404, message: 'No Attic inscription with that identifier.' })
  }

  return inscription
})
