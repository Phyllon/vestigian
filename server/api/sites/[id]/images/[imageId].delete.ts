import { z } from 'zod'
import type { SessionUser } from '#shared/types'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
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
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const user = session.user as SessionUser

  const { id: siteId, imageId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const sql = useSql()

  const [image] = await sql<{ id: number; created_by: number | null; status: string }[]>`
    SELECT id, created_by, status FROM site_images
    WHERE id = ${imageId} AND site_id = ${siteId} LIMIT 1
  `

  if (!image) throw createError({ statusCode: 404, message: 'No such photograph on this site.' })

  if (!canManageImage(user, image.created_by)) {
    throw createError({ statusCode: 403, message: 'That photograph is not yours to remove.' })
  }

  await sql`UPDATE site_images SET status = 'rejected' WHERE id = ${imageId}`
  await bumpDataVersion()

  return { imageId, status: 'withdrawn' }
})
