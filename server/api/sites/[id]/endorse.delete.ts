import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteEndorsements } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/** Withdraws the caller's own endorsement. Idempotent — nothing to withdraw is not an error. */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Withdraw "found useful"',
    description: 'Idempotent. Returns the new public count.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = (session.user as SessionUser).id
  await enforceRateLimit(event, 'contribute')

  const { id: siteId } = await getValidatedRouterParams(event, paramsSchema.parse)

  await useDatabase()
    .delete(siteEndorsements)
    .where(and(eq(siteEndorsements.userId, userId), eq(siteEndorsements.siteId, siteId)))

  return { siteId, ...(await readEndorsementState(siteId, userId)) }
})
