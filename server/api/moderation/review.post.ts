import { z } from 'zod'
import type { SessionUser } from '#shared/types'

const reviewSchema = z.object({
  revisionId: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})

export default defineEventHandler(async (event) => {
  const moderator = (await requireModerator(event)) as SessionUser
  const { revisionId, decision, note } = await readValidatedBody(event, reviewSchema.parse)
  const sql = useSql()

  const [revision] = await sql<{ id: number; author_id: number | null; status: string }[]>`
    SELECT id, author_id, status FROM revisions WHERE id = ${revisionId} LIMIT 1
  `

  if (!revision) throw createError({ statusCode: 404, message: 'Revision not found.' })
  if (revision.status !== 'pending') {
    throw createError({ statusCode: 409, message: 'This revision has already been reviewed.' })
  }
  if (!canReviewRevision(moderator, revision.author_id)) {
    throw createError({ statusCode: 403, message: 'You cannot review your own contribution.' })
  }

  await sql`
    UPDATE revisions
    SET status = ${decision}, reviewer_id = ${moderator.id},
        review_note = ${note ?? null}, reviewed_at = now()
    WHERE id = ${revisionId}
  `

  if (decision === 'approved') {
    await applyRevision(revisionId)
    await bumpDataVersion()
  }

  return { revisionId, status: decision }
})
