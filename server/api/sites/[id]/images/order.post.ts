import { z } from 'zod'
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
  const sql = useSql()

  const rows = await sql<{ id: number; sort_order: number; created_by: number | null }[]>`
    SELECT id, sort_order, created_by
    FROM site_images
    WHERE site_id = ${siteId} AND status = 'approved'
    ORDER BY sort_order, id
  `

  const target = rows.find((row) => row.id === imageId)
  if (!target) throw createError({ statusCode: 404, message: 'No such photograph on this site.' })

  if (!canManageImage(user, target.created_by)) {
    throw createError({ statusCode: 403, message: 'That photograph is not yours to reorder.' })
  }

  const reordered = applyReorder(
    rows.map((row) => ({ id: row.id, sortOrder: row.sort_order })),
    imageId,
    targetIndex,
  )

  await sql.begin(async (tx) => {
    for (const image of reordered) {
      await tx`UPDATE site_images SET sort_order = ${image.sortOrder} WHERE id = ${image.id}`
    }
  })

  return { order: reordered.map((image) => image.id) }
})
