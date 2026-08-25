import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revisions } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

const reviewSchema = z.object({
  revisionId: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})

export default defineEventHandler(async (event) => {
  const moderator = (await requireModerator(event)) as SessionUser
  const { revisionId, decision, note } = await readValidatedBody(event, reviewSchema.parse)
  const database = useDatabase()

  const [revision] = await database
    .select({ id: revisions.id, authorId: revisions.authorId, status: revisions.status })
    .from(revisions)
    .where(eq(revisions.id, revisionId))
    .limit(1)

  if (!revision) throw createError({ statusCode: 404, message: 'Revision not found.' })
  if (revision.status !== 'pending') {
    throw createError({ statusCode: 409, message: 'This revision has already been reviewed.' })
  }
  if (!canReviewRevision(moderator, revision.authorId)) {
    throw createError({ statusCode: 403, message: 'You cannot review your own contribution.' })
  }

  await database
    .update(revisions)
    .set({
      status: decision,
      reviewerId: moderator.id,
      reviewNote: note ?? null,
      reviewedAt: new Date(),
    })
    .where(eq(revisions.id, revisionId))

  if (decision === 'approved') {
    await applyRevision(revisionId)
    await bumpDataVersion()
  }

  return { revisionId, status: decision }
})
