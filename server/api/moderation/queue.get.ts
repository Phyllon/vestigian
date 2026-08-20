import { z } from 'zod'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().positive().optional(),
})

/**
 * Pending revisions, oldest first — the queue is a fairness ordering, not a
 * priority one. Each item arrives with its diff already computed, so a
 * moderator sees what changed rather than two records to compare by eye.
 */
export default defineEventHandler(async (event) => {
  await requireModerator(event)
  const { limit, cursor } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const rows = await sql<
    {
      id: number
      entity_type: string
      entity_id: number | null
      payload: Record<string, unknown>
      previous_payload: Record<string, unknown> | null
      edit_summary: string | null
      created_at: Date
      author_id: number | null
      author_name: string | null
      author_accepted: number | null
    }[]
  >`
    SELECT r.id, r.entity_type, r.entity_id, r.payload, r.previous_payload,
           r.edit_summary, r.created_at,
           u.id AS author_id, u.display_name AS author_name,
           u.approved_contributions AS author_accepted
    FROM revisions r
    LEFT JOIN users u ON u.id = r.author_id
    WHERE r.status = 'pending' ${cursor ? sql`AND r.id > ${cursor}` : sql``}
    ORDER BY r.id ASC
    LIMIT ${limit}
  `

  const items = rows.map((row) => {
    const changes = diffPayloads(row.previous_payload, row.payload)
    return {
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      payload: row.payload,
      edit_summary: row.edit_summary,
      changes,
      // Surfaced so a moderator can triage: large rewrites and blanking edits
      // deserve a closer look than a corrected date.
      substantial: isSubstantialEdit(changes),
      blanking: isBlankingEdit(changes),
      created_at: row.created_at.toISOString(),
      author_name: row.author_name,
      author_accepted: row.author_accepted ?? 0,
    }
  })

  return {
    items,
    nextCursor: items.length === limit ? items[items.length - 1]!.id : null,
  }
})
