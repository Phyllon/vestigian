import { z } from 'zod'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

/**
 * The history of one site. Public, because a record whose provenance cannot be
 * inspected is a record no one should cite.
 */
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const sql = useSql()

  const rows = await sql<
    {
      id: number
      payload: Record<string, unknown>
      previous_payload: Record<string, unknown> | null
      edit_summary: string | null
      status: string
      auto_approved: number
      reverts_revision_id: number | null
      created_at: Date
      author_name: string | null
      reviewer_name: string | null
    }[]
  >`
    SELECT r.id, r.payload, r.previous_payload, r.edit_summary, r.status,
           r.auto_approved, r.reverts_revision_id, r.created_at,
           author.display_name AS author_name,
           reviewer.display_name AS reviewer_name
    FROM revisions r
    LEFT JOIN users author ON author.id = r.author_id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
    WHERE r.entity_type = 'site' AND r.entity_id = ${id} AND r.status = 'approved'
    ORDER BY r.created_at DESC
    LIMIT 100
  `

  return rows.map((row) => ({
    id: row.id,
    editSummary: row.edit_summary,
    createdAt: row.created_at.toISOString(),
    authorName: row.author_name,
    reviewerName: row.reviewer_name,
    autoApproved: row.auto_approved === 1,
    isRevert: row.reverts_revision_id !== null,
    changes: diffPayloads(row.previous_payload, row.payload),
  }))
})
