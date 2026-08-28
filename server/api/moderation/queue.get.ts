import { z } from 'zod'
import { and, asc, eq, gt } from 'drizzle-orm'
import { revisions, users } from '~~/server/database/schema'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: routeIdentifier.optional(),
})

/**
 * Pending revisions, oldest first — the queue is a fairness ordering, not a
 * priority one. Each item arrives with its diff already computed, so a
 * moderator sees what changed rather than two records to compare by eye.
 */
export default defineEventHandler(async (event) => {
  await requireModerator(event)
  await enforceRateLimit(event, 'record')
  const { limit, cursor } = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const rows = await database
    .select({
      id: revisions.id,
      entityType: revisions.entityType,
      entityId: revisions.entityId,
      payload: revisions.payload,
      previousPayload: revisions.previousPayload,
      editSummary: revisions.editSummary,
      createdAt: revisions.createdAt,
      authorName: users.displayName,
      authorAccepted: users.approvedContributions,
    })
    .from(revisions)
    // Left, not inner: a contribution outlives the account that made it.
    .leftJoin(users, eq(users.id, revisions.authorId))
    .where(and(eq(revisions.status, 'pending'), cursor ? gt(revisions.id, cursor) : undefined))
    .orderBy(asc(revisions.id))
    .limit(limit)

  const items = rows.map((row) => {
    const changes = diffPayloads(
      row.previousPayload as StoredPayload | null,
      row.payload as StoredPayload,
    )
    return {
      id: row.id,
      entity_type: row.entityType,
      entity_id: row.entityId,
      payload: row.payload,
      edit_summary: row.editSummary,
      changes,
      // Surfaced so a moderator can triage: large rewrites and blanking edits
      // deserve a closer look than a corrected date.
      substantial: isSubstantialEdit(changes),
      blanking: isBlankingEdit(changes),
      created_at: row.createdAt.toISOString(),
      author_name: row.authorName,
      author_accepted: row.authorAccepted ?? 0,
    }
  })

  return {
    items,
    nextCursor: items.length === limit ? items[items.length - 1]!.id : null,
  }
})
