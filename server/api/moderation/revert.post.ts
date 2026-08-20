import { z } from 'zod'
import type { SessionUser } from '#shared/types'

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
  const moderator = (await requireModerator(event)) as SessionUser
  const { revisionId, reason } = await readValidatedBody(event, revertSchema.parse)
  const sql = useSql()

  const [target] = await sql<
    {
      id: number
      entity_type: string
      entity_id: number | null
      previous_payload: Record<string, unknown> | null
    }[]
  >`
    SELECT id, entity_type, entity_id, previous_payload
    FROM revisions WHERE id = ${revisionId} AND status = 'approved' LIMIT 1
  `

  if (!target) {
    throw createError({ statusCode: 404, message: 'No published revision with that id.' })
  }

  if (!target.previous_payload || !target.entity_id) {
    throw createError({
      statusCode: 400,
      message: 'That revision created the record, so there is no earlier state to restore.',
    })
  }

  const restored = {
    ...target.previous_payload,
    kind: target.entity_type,
    entityId: target.entity_id,
  }

  const [revision] = await sql<{ id: number }[]>`
    INSERT INTO revisions (
      entity_type, entity_id, payload, previous_payload, edit_summary,
      status, author_id, reviewer_id, auto_approved, reverts_revision_id, reviewed_at
    )
    VALUES (
      ${target.entity_type}, ${target.entity_id}, ${sql.json(restored)},
      (SELECT payload FROM revisions WHERE id = ${revisionId}),
      ${reason ?? `Reverted revision ${revisionId}`},
      'approved', ${moderator.id}, ${moderator.id}, 0, ${revisionId}, now()
    )
    RETURNING id
  `

  await applyRevision(revision!.id)
  await bumpDataVersion()

  return { revisionId: revision!.id, revertedRevisionId: revisionId, status: 'reverted' }
})
