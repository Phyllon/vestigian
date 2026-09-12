import { z } from 'zod'

export const revertSchema = z.object({
  revisionId: databaseIdentifier,
  reason: z.string().trim().max(300).optional(),
})

/**
 * Restores the state a record had before a given revision.
 *
 * What a revert *is* now lives in `revertRevision` (`server/utils/revisions.ts`),
 * because the bulk retraction sweep in `/admin` reverts too and a revert that
 * two places implement is a revert two places can get wrong. This handler
 * keeps only the HTTP concerns.
 *
 * A revert is written as a new revision rather than by deleting the offending
 * one. History stays append-only, so the record of what was reverted and by
 * whom survives — which is the whole point of keeping revisions at all.
 */
defineRouteMeta({
  openAPI: {
    tags: ['moderation'],
    summary: 'Restore the state a record had before a given revision',
    description:
      'Moderator only. Writes a new revision rather than deleting the offending one — history stays append-only. Also un-retracts a record taken offline by an administrator, since a retraction is itself an ordinary revision.',
  },
})

export default defineEventHandler(async (event) => {
  const moderator = await requireModerator(event)
  await enforceRateLimit(event, 'contribute')
  const { revisionId, reason } = await readValidatedBody(event, revertSchema.parse)

  const result = await revertRevision({ revisionId, moderatorId: moderator.id, reason })
  await bumpDataVersion()

  moderationActionsTotal().inc({ action: 'revert' })
  event.context.log.info(
    {
      audit: 'moderation.revert',
      revisionId: result.revisionId,
      revertedRevisionId: result.revertedRevisionId,
      moderatorId: moderator.id,
    },
    'revision reverted',
  )

  return { ...result, status: 'reverted' }
})
