import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteImages } from '~~/server/database/schema'
import { canManageImage } from '#shared/utils/authorization'

export const paramsSchema = z.object({
  id: routeIdentifier,
  imageId: routeIdentifier,
})

/**
 * Withdraws a photograph from the public gallery.
 *
 * The row is marked rejected rather than deleted, and the object stays in
 * storage. Two reasons: a moderator can reverse a mistaken removal, and a
 * takedown request needs an auditable record that the image was removed and
 * when — which a hard delete destroys.
 *
 * Purging the stored object is a separate, deliberate operation.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Withdraw a photograph from the public gallery',
    description:
      'Marks the row rejected; the stored object is untouched. Nothing in this project deletes bytes.',
  },
})

export default defineEventHandler(async (event) => {
  const user = await requireActiveUser(event)
  await enforceRateLimit(event, 'contribute')

  const { id: siteId, imageId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const database = useDatabase()

  const [image] = await database
    .select({ id: siteImages.id, createdBy: siteImages.createdBy, status: siteImages.status })
    .from(siteImages)
    .where(and(eq(siteImages.id, imageId), eq(siteImages.siteId, siteId)))
    .limit(1)

  if (!image) throw createError({ statusCode: 404, message: 'No such photograph on this site.' })

  if (!canManageImage(user, image.createdBy)) {
    throw createError({ statusCode: 403, message: 'That photograph is not yours to remove.' })
  }

  await database.update(siteImages).set({ status: 'rejected' }).where(eq(siteImages.id, imageId))
  await bumpDataVersion()

  return { imageId, status: 'withdrawn' }
})
