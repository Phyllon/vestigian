import { z } from 'zod'
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm'
import { revisions, users } from '~~/server/database/schema'

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
  const database = useDatabase()

  const rows = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      trustLevel: users.trustLevel,
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      // Correlated rather than joined: a join would multiply the user row by
      // its pending revisions and need a GROUP BY to put it back together.
      pendingCount: sql<number>`(
        SELECT count(*)::int FROM ${revisions}
        WHERE ${and(eq(revisions.authorId, users.id), eq(revisions.status, 'pending'))}
      )`,
    })
    .from(users)
    .where(search ? ilike(users.displayName, `%${search}%`) : undefined)
    .orderBy(desc(users.approvedContributions), asc(users.id))
    .limit(limit)

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  }))
})
