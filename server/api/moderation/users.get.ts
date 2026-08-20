import { z } from 'zod'

const querySchema = z.object({
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/**
 * The contributor list. Deliberately does not expose email addresses: a
 * moderator needs to judge contributions, not to contact people directly.
 */
export default defineEventHandler(async (event) => {
  await requireModerator(event)
  const { search, limit } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const rows = await sql<
    {
      id: number
      display_name: string
      role: string
      trust_level: number
      approved_contributions: number
      trust_revoked: boolean
      pending_count: number
      created_at: Date
      last_seen_at: Date | null
    }[]
  >`
    SELECT u.id, u.display_name, u.role::text AS role, u.trust_level,
           u.approved_contributions, u.trust_revoked, u.created_at, u.last_seen_at,
           (SELECT count(*)::int FROM revisions r
             WHERE r.author_id = u.id AND r.status = 'pending') AS pending_count
    FROM users u
    ${search ? sql`WHERE u.display_name ILIKE ${'%' + search + '%'}` : sql``}
    ORDER BY u.approved_contributions DESC, u.id ASC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    trustLevel: row.trust_level,
    approvedContributions: row.approved_contributions,
    trustRevoked: row.trust_revoked,
    pendingCount: row.pending_count,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
  }))
})
