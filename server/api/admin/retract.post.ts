import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { revisions, siteImages, sites, tracings, users } from '~~/server/database/schema'

export const retractSchema = z.object({
  userId: databaseIdentifier,
  /**
   * Off by default, and the whole safety of this endpoint. Without it nothing
   * is written and the plan comes back to be counted in the confirmation —
   * so the panel can say "34 records and 12 photographs" using the same
   * function that will then act on exactly those, rather than a count
   * assembled separately and liable to disagree.
   */
  apply: z.boolean().default(false),
  reason: z.string().trim().min(1).max(300),
})

interface RetractionOutcome {
  kind: 'record' | 'edit' | 'photograph'
  id: number
  status: 'done' | 'failed'
  detail?: string
}

/**
 * Takes everything one account published off the atlas.
 *
 * Separate from `ban.post.ts` by decision: blocking a person and unpublishing
 * their back catalogue are different-sized acts, and a block that silently did
 * both would be far larger than the button suggests. This is the second,
 * deliberate step, reached from the dossier where the work is actually visible.
 *
 * Three write paths, all pre-existing, none of them new (`planRetraction`
 * decides which applies where, and its own docstring explains why that
 * decision is separated out):
 *
 *  - a record the account **created** is retracted whole — an approved
 *    revision carrying `retracted: true`, applied by `applyRevision`, so no
 *    second path to a live row is invented and `revert.post.ts` un-retracts it
 *    with no new code;
 *  - an **edit** to somebody else's record is reverted, exactly as a moderator
 *    would revert it, restoring the state before they touched it;
 *  - a **photograph** is marked rejected, the same write the gallery's own
 *    withdrawal already makes. Nothing deletes bytes.
 *
 * Outcomes are reported per item rather than thrown. A prolific contributor
 * can have hundreds of records, and one that will not apply must not abandon
 * the rest — the pattern `moderation/review-batch.post.ts` established for the
 * same reason.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Take everything one account published off the atlas',
    description:
      'Admin only, and requires re-authentication. Call with apply=false first: nothing is written and the counted plan comes back for confirmation. Reversible — each retraction is an ordinary revision a moderator can revert, and no image bytes are deleted. Pending revisions are deliberately left in the moderation queue.',
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await enforceRateLimit(event, 'contribute')
  const { userId, apply, reason } = await readValidatedBody(event, retractSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  if (admin.id === userId) {
    throw createError({
      statusCode: 403,
      message: 'Use the ordinary editing tools on your own contributions.',
    })
  }

  const [createdSites, createdTracings, authoredRevisions, uploadedImages] = await Promise.all([
    database
      .select({ entityId: sites.id, status: sites.status })
      .from(sites)
      .where(eq(sites.createdBy, userId)),
    database
      .select({ entityId: tracings.id, status: tracings.status })
      .from(tracings)
      .where(eq(tracings.createdBy, userId)),
    database
      .select({
        id: revisions.id,
        entityType: revisions.entityType,
        entityId: revisions.entityId,
        status: revisions.status,
        revertsRevisionId: revisions.revertsRevisionId,
      })
      .from(revisions)
      .where(eq(revisions.authorId, userId)),
    database
      .select({ id: siteImages.id, status: siteImages.status })
      .from(siteImages)
      .where(eq(siteImages.createdBy, userId)),
  ])

  const plan = planRetraction({
    createdRecords: [
      ...createdSites.map((row) => ({ entityType: 'site' as const, ...row })),
      ...createdTracings.map((row) => ({ entityType: 'tracing' as const, ...row })),
    ],
    authoredRevisions: authoredRevisions.map((row) => ({
      ...row,
      entityType: row.entityType as 'site' | 'tracing',
    })),
    uploadedImages,
  })

  const summary = summariseRetraction(plan)

  if (!apply) {
    return {
      userId,
      applied: false as const,
      summary,
      untouched: plan.untouched.map((entry) => ({
        ...entry,
        explanation: describeRetractionSkip(entry.reason),
      })),
    }
  }

  await requireStepUp(event, admin)

  const outcomes: RetractionOutcome[] = []

  for (const record of plan.retractions) {
    try {
      await retractRecord({
        entityType: record.entityType,
        entityId: record.entityId,
        moderatorId: admin.id,
        reason,
      })
      outcomes.push({ kind: 'record', id: record.entityId, status: 'done' })
    } catch (error) {
      event.context.log.error(
        {
          audit: 'admin.retract',
          entityType: record.entityType,
          entityId: record.entityId,
          err: { message: (error as Error).message },
        },
        'record could not be retracted',
      )
      outcomes.push({
        kind: 'record',
        id: record.entityId,
        status: 'failed',
        detail: (error as Error).message.slice(0, 120),
      })
    }
  }

  for (const revisionId of plan.reverts) {
    try {
      await revertRevision({ revisionId, moderatorId: admin.id, reason })
      outcomes.push({ kind: 'edit', id: revisionId, status: 'done' })
    } catch (error) {
      event.context.log.error(
        { audit: 'admin.retract', revisionId, err: { message: (error as Error).message } },
        'edit could not be reverted',
      )
      outcomes.push({
        kind: 'edit',
        id: revisionId,
        status: 'failed',
        detail: (error as Error).message.slice(0, 120),
      })
    }
  }

  // One statement for every photograph: unlike a record, withdrawing an image
  // is a single column and has no per-item failure mode worth reporting.
  if (plan.imageWithdrawals.length > 0) {
    await database
      .update(siteImages)
      .set({ status: 'rejected' })
      .where(inArray(siteImages.id, plan.imageWithdrawals))

    for (const imageId of plan.imageWithdrawals) {
      outcomes.push({ kind: 'photograph', id: imageId, status: 'done' })
    }
  }

  // One invalidation for the whole sweep, not one per record.
  await bumpDataVersion()
  await consumeStepUp(event, admin)

  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length

  await recordAdminAction({
    actorId: admin.id,
    action: 'account.work-retracted',
    subjectType: 'account',
    subjectId: userId,
    detail: { reason, ...summary, failed },
  })

  moderationActionsTotal().inc({ action: 'retract' })
  event.context.log.warn(
    { audit: 'admin.retract', targetUserId: userId, actorId: admin.id, ...summary, failed },
    'account work retracted',
  )

  return {
    userId,
    applied: true as const,
    summary,
    failed,
    outcomes,
    untouched: plan.untouched.map((entry) => ({
      ...entry,
      explanation: describeRetractionSkip(entry.reason),
    })),
  }
})
