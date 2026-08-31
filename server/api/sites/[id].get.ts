import { z } from 'zod'
import type { SiteDetail } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * Full record for one site. Tiles carry only an identifier and a label, so this
 * is what the detail panel opens with. The read itself lives in
 * `loadSiteDetail` because the slug route serves the same record.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Get a site by numeric id',
  },
})

export default defineEventHandler(async (event): Promise<SiteDetail> => {
  await enforceRateLimit(event, 'record')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const site = await loadSiteDetail(id)

  if (!site) {
    throw createError({ statusCode: 404, message: 'No approved site with that identifier.' })
  }

  return site
})
