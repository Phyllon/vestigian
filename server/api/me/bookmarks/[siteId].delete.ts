import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteBookmarks } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const paramsSchema = z.object({ siteId: routeIdentifier })

/** Removes a site from the to-visit list. Idempotent, for the same reason the add is. */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Remove a site from the to-visit list',
    description: 'Idempotent — removing something already absent is not an error.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = (session.user as SessionUser).id
  await enforceRateLimit(event, 'contribute')

  const { siteId } = await getValidatedRouterParams(event, paramsSchema.parse)

  await useDatabase()
    .delete(siteBookmarks)
    .where(and(eq(siteBookmarks.userId, userId), eq(siteBookmarks.siteId, siteId)))

  return { siteId, status: 'removed' as const }
})
