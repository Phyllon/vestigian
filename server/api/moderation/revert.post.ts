import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { revisions } from '~~/server/database/schema'

const revertSchema = z.object({
  revisionId: z.number().int().positive(),
  reason: z.string().trim().max(300).optional(),
})

/**
 * Restores the state a record had before a given revision.
 *
 * A revert is written as a new revision rather than by deleting the offending
 * one. History stays append-only, so the record of what was reverted and by
 * whom survives — which is the whole point of keeping revisions at all.
 */
export default defineEventHandler(async (event) => {
  const moderator = await requireModerator(event)
  await enforceRateLimit(event, 'contribute')
  const { revisionId, reason } = await readValidatedBody(event, revertSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({
      id: revisions.id,
      entityType: revisions.entityType,
      entityId: revisions.entityId,
      payload: revisions.payload,
      previousPayload: revisions.previousPayload,
    })
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.status, 'approved')))
    .limit(1)

  if (!target) {
    throw createError({ statusCode: 404, message: 'No published revision with that id.' })
  }

  if (!target.previousPayload || !target.entityId) {
    throw createError({
      statusCode: 400,
      message: 'That revision created the record, so there is no earlier state to restore.',
    })
  }

  const restored = {
    ...(target.previousPayload as StoredPayload),
    kind: target.entityType,
    entityId: target.entityId,
  }

  /**
   * `previousPayload` is what this revert replaces — the state the offending
   * revision put there — so it is that revision's `payload`. It was read above
   * rather than re-selected in a subquery, which is what the raw version did.
   */
  const [revision] = await database
    .insert(revisions)
    .values({
      entityType: target.entityType,
      entityId: target.entityId,
      payload: restored,
      previousPayload: target.payload,
      editSummary: reason ?? `Reverted revision ${revisionId}`,
      status: 'approved',
      authorId: moderator.id,
      reviewerId: moderator.id,
      autoApproved: 0,
      revertsRevisionId: revisionId,
      reviewedAt: sql`now()`,
    })
    .returning({ id: revisions.id })

  await applyRevision(revision!.id)
  await bumpDataVersion()

  moderationActionsTotal().inc({ action: 'revert' })
  event.context.log.info(
    {
      audit: 'moderation.revert',
      revisionId: revision!.id,
      revertedRevisionId: revisionId,
      moderatorId: moderator.id,
    },
    'revision reverted',
  )

  return { revisionId: revision!.id, revertedRevisionId: revisionId, status: 'reverted' }
})
