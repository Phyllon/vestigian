import { z } from 'zod'
import type { SessionUser, SiteDetail } from '#shared/types'

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
  await enforceRateLimit(event, 'recordDaily')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Never required: this route is public, and `endorsedByMe` is simply
  // `false` for a signed-out reader rather than something the route refuses.
  const session = await getUserSession(event)
  const viewerId = (session.user as SessionUser | undefined)?.id ?? null

  const site = await loadSiteDetail(id, viewerId)

  if (!site) {
    throw createError({ statusCode: 404, message: 'No approved site with that identifier.' })
  }

  return site
})
