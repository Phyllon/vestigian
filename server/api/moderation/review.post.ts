import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revisions } from '~~/server/database/schema'
import { canReviewRevision } from '#shared/utils/authorization'

export const reviewSchema = z.object({
  revisionId: databaseIdentifier,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})

defineRouteMeta({
  openAPI: {
    tags: ['moderation'],
    summary: 'Approve or reject one pending revision',
    description: 'Moderator only, and never on your own contribution — see canReviewRevision.',
  },
})

export default defineEventHandler(async (event) => {
  const moderator = await requireModerator(event)
  await enforceRateLimit(event, 'contribute')
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

  // After the decision is written and applied, never before: the author is told
  // what happened, and a failure here cannot undo what already did.
  await notifyReviewDecision({
    revisionId,
    decision,
    note: note ?? null,
    moderatorName: moderator.displayName,
  })

  moderationActionsTotal().inc({ action: decision })
  event.context.log.info(
    {
      audit: 'moderation.review',
      revisionId,
      decision,
      moderatorId: moderator.id,
      authorId: revision.authorId,
    },
    'revision reviewed',
  )

  return { revisionId, status: decision }
})
