import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

/**
 * The notebook as a GPX waypoint file — the one thing here that leaves the
 * browser and works with no signal at all. See `server/utils/gpx.ts` for why it
 * exists and why it is written by hand.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Download the caller’s places as a GPX waypoint file',
    description:
      'Visits and to-visit entries as GPX 1.1, for a handheld GPS or an offline phone map. Visited places carry a green flag, unvisited a blue one.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'record')

  const [places, [account]] = await Promise.all([
    readNotebookPlaces(sessionUser.id),
    useDatabase()
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1),
  ])

  setResponseHeader(event, 'content-type', 'application/gpx+xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'content-disposition', 'attachment; filename="vestigia-field-kit.gpx"')

  return buildFieldKitGpx({
    places,
    authorName: account?.displayName ?? sessionUser.displayName,
    generatedAt: new Date(),
  })
})
