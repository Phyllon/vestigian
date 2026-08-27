import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { revisions } from '~~/server/database/schema'
import { canReviewRevision } from '#shared/utils/authorization'

const batchSchema = z.object({
  revisionIds: z.array(z.number().int().positive()).min(1).max(50),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})

interface BatchOutcome {
  revisionId: number
  status: 'approved' | 'rejected' | 'skipped'
  reason?: string
}

/**
 * Reviews several revisions in one action, for the case where a queue fills
 * with obvious spam or a run of good edits from one contributor.
 *
 * Each revision is decided independently and failures are reported rather than
 * thrown: one revision that cannot be applied must not silently abandon the
 * other forty-nine, and the moderator needs to know precisely which ones did
 * not go through.
 */
export default defineEventHandler(async (event) => {
  const moderator = await requireModerator(event)
  const { revisionIds, decision, note } = await readValidatedBody(event, batchSchema.parse)
  const database = useDatabase()

  const rows = await database
    .select({ id: revisions.id, authorId: revisions.authorId, status: revisions.status })
    .from(revisions)
    .where(inArray(revisions.id, revisionIds))

  const found = new Map(rows.map((row) => [row.id, row]))
  const outcomes: BatchOutcome[] = []
  let appliedAny = false

  for (const revisionId of revisionIds) {
    const revision = found.get(revisionId)

    if (!revision) {
      outcomes.push({ revisionId, status: 'skipped', reason: 'No such revision.' })
      continue
    }

    if (revision.status !== 'pending') {
      outcomes.push({ revisionId, status: 'skipped', reason: 'Already reviewed.' })
      continue
    }

    if (!canReviewRevision(moderator, revision.authorId)) {
      outcomes.push({ revisionId, status: 'skipped', reason: 'Your own contribution.' })
      continue
    }

    try {
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
        appliedAny = true
      }

      outcomes.push({ revisionId, status: decision })
    } catch (error) {
      // Roll this one back to pending so it returns to the queue rather than
      // being lost in an ambiguous half-reviewed state.
      await database
        .update(revisions)
        .set({ status: 'pending', reviewerId: null, reviewedAt: null })
        .where(eq(revisions.id, revisionId))
      // The moderator sees this truncated to 120 characters and nothing
      // persists it, so a revision that consistently fails to apply leaves no
      // record of why once they close the tab.
      event.context.log.error(
        { revisionId, err: { message: (error as Error).message, stack: (error as Error).stack } },
        'batch review could not apply revision',
      )
      outcomes.push({
        revisionId,
        status: 'skipped',
        reason: (error as Error).message.slice(0, 120),
      })
    }
  }

  // One invalidation for the whole batch, not one per revision.
  if (appliedAny) await bumpDataVersion()

  const succeeded = outcomes.filter((outcome) => outcome.status !== 'skipped').length

  return {
    outcomes,
    succeeded,
    skipped: outcomes.length - succeeded,
  }
})
