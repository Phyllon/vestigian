import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { siteImages } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const bodySchema = z.object({
  imageId: z.number().int().positive(),
  targetIndex: z.number().int().min(0).max(200),
})

/**
 * Reorders one site's gallery. The whole new ordering is written rather than a
 * delta, which is cheap at gallery scale and removes the class of bug where two
 * concurrent reorders leave the sequence inconsistent.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const user = session.user as SessionUser

  const { id: siteId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { imageId, targetIndex } = await readValidatedBody(event, bodySchema.parse)
  const database = useDatabase()

  const rows = await database
    .select({
      id: siteImages.id,
      sortOrder: siteImages.sortOrder,
      createdBy: siteImages.createdBy,
    })
    .from(siteImages)
    .where(and(eq(siteImages.siteId, siteId), eq(siteImages.status, 'approved')))
    .orderBy(asc(siteImages.sortOrder), asc(siteImages.id))

  const target = rows.find((row) => row.id === imageId)
  if (!target) throw createError({ statusCode: 404, message: 'No such photograph on this site.' })

  if (!canManageImage(user, target.createdBy)) {
    throw createError({ statusCode: 403, message: 'That photograph is not yours to reorder.' })
  }

  const reordered = applyReorder(
    rows.map((row) => ({ id: row.id, sortOrder: row.sortOrder })),
    imageId,
    targetIndex,
  )

  // One transaction for the whole sequence: a gallery half-renumbered is worse
  // than one not renumbered at all.
  await database.transaction(async (tx) => {
    for (const image of reordered) {
      await tx
        .update(siteImages)
        .set({ sortOrder: image.sortOrder })
        .where(eq(siteImages.id, image.id))
    }
  })

  return { order: reordered.map((image) => image.id) }
})
