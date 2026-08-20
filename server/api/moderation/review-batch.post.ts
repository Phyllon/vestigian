import { z } from 'zod'
import type { SessionUser } from '#shared/types'

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
  const moderator = (await requireModerator(event)) as SessionUser
  const { revisionIds, decision, note } = await readValidatedBody(event, batchSchema.parse)
  const sql = useSql()

  const rows = await sql<{ id: number; author_id: number | null; status: string }[]>`
    SELECT id, author_id, status FROM revisions WHERE id = ANY(${revisionIds})
  `

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

    if (!canReviewRevision(moderator, revision.author_id)) {
      outcomes.push({ revisionId, status: 'skipped', reason: 'Your own contribution.' })
      continue
    }

    try {
      await sql`
        UPDATE revisions
        SET status = ${decision}, reviewer_id = ${moderator.id},
            review_note = ${note ?? null}, reviewed_at = now()
        WHERE id = ${revisionId}
      `

      if (decision === 'approved') {
        await applyRevision(revisionId)
        appliedAny = true
      }

      outcomes.push({ revisionId, status: decision })
    } catch (error) {
      // Roll this one back to pending so it returns to the queue rather than
      // being lost in an ambiguous half-reviewed state.
      await sql`
        UPDATE revisions SET status = 'pending', reviewer_id = NULL, reviewed_at = NULL
        WHERE id = ${revisionId}
      `
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
