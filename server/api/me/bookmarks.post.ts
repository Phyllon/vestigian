import { z } from 'zod'
import { siteBookmarks } from '~~/server/database/schema'

export const bookmarkSchema = z.object({ siteId: databaseIdentifier })

/**
 * Marks a site to visit. Idempotent — marking twice is not an error, because
 * the button that calls this is a toggle and a double tap is not a mistake
 * worth a 409.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'Add a site to the to-visit list',
    description:
      'Idempotent. Like visits, this does not go through the revision queue — it is personal data, not a change to the shared record.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'contribute')

  const { siteId } = await readValidatedBody(event, bookmarkSchema.parse)
  await requirePublishedSite(siteId)

  await useDatabase()
    .insert(siteBookmarks)
    .values({ userId, siteId })
    .onConflictDoNothing({
      target: [siteBookmarks.userId, siteBookmarks.siteId],
    })

  return { siteId, status: 'saved' as const }
})
