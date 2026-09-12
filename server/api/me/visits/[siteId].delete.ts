import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteVisits } from '~~/server/database/schema'

export const paramsSchema = z.object({ siteId: routeIdentifier })

/**
 * Removes a visit.
 *
 * A real delete, unlike everything else in this project: the revision history
 * is append-only because it is the shared record's audit trail, and a
 * photograph is withdrawn rather than erased because someone else may be
 * relying on the bytes. Neither applies to a private note about where its
 * author has been. "I did not, in fact, go there" has to be expressible, and
 * an atlas that kept a tombstone for it would be keeping worse data than none.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Remove a visit from the log',
    description:
      'Deletes the caller’s visit to this site outright, note included. Unlike revisions and photographs this leaves no tombstone — a private record of someone’s movements is not an audit trail.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'contribute')

  const { siteId } = await getValidatedRouterParams(event, paramsSchema.parse)

  const removed = await useDatabase()
    .delete(siteVisits)
    .where(and(eq(siteVisits.userId, userId), eq(siteVisits.siteId, siteId)))
    .returning({ siteId: siteVisits.siteId })

  if (removed.length === 0) {
    throw createError({ statusCode: 404, message: 'No visit recorded for that site.' })
  }

  event.context.log.info({ audit: 'me.visit-removed', userId, siteId }, 'visit removed')

  return { siteId, status: 'removed' as const }
})
