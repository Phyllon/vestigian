import { z } from 'zod'
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { revisions, users } from '~~/server/database/schema'

export const querySchema = z.object({
  /** Matches display name **or** email address. */
  search: z.string().trim().max(120).optional(),
  role: z.enum(['contributor', 'moderator', 'admin']).optional(),
  standing: z.enum(['trusted', 'revoked', 'banned', 'unverified']).optional(),
  sort: z.enum(['accepted', 'newest', 'lastSeen', 'pending']).default('accepted'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/**
 * The account roll, replacing `moderation/users.get.ts`.
 *
 * That endpoint deliberately withheld email addresses on the grounds that a
 * moderator judges contributions rather than people, which is right for a
 * moderator and wrong for the administrator who has to act on an abuse report
 * naming an address, or tie a run of signups to one disposable domain. The
 * address is therefore returned here — and every request is written to the
 * audit log, which is what makes the wider disclosure accountable rather than
 * merely convenient. Search matches on it, so "is this address registered" is
 * answerable without reading a column full of addresses that are nobody's
 * business on this screen.
 *
 * Still withheld, and not negotiable: the password hash and the encrypted TOTP
 * secret. Neither has any use in a user interface.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Every account, with standing, role and email address',
    description:
      'Admin only, and audited on every request. Unlike the moderator contributor list this returns email addresses, because an administrator has to act on reports that name one. Never returns the password hash or the TOTP secret.',
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await enforceRateLimit(event, 'admin')
  const query = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const searchTerm = query.search ? `%${query.search}%` : null

  const pendingCount = sql<number>`(
    SELECT count(*)::int FROM ${revisions}
    WHERE ${and(eq(revisions.authorId, users.id), eq(revisions.status, 'pending'))}
  )`

  const ORDER_BY = {
    accepted: [desc(users.approvedContributions), asc(users.id)],
    newest: [desc(users.createdAt)],
    lastSeen: [desc(users.lastSeenAt)],
    pending: [desc(pendingCount), asc(users.id)],
  } as const

  const STANDING_FILTER = {
    trusted: eq(users.trustRevoked, false),
    revoked: eq(users.trustRevoked, true),
    banned: isNotNull(users.bannedAt),
    unverified: isNull(users.emailVerifiedAt),
  } as const

  const rows = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      bannedAt: users.bannedAt,
      banReason: users.banReason,
      bannedBy: users.bannedBy,
      emailVerifiedAt: users.emailVerifiedAt,
      // The flag, never the ciphertext.
      twoFactorEnabled: sql<boolean>`${users.totpEnabledAt} IS NOT NULL`,
      publicProfile: users.publicProfile,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      // Correlated rather than joined: a join would multiply the user row by
      // its pending revisions and need a GROUP BY to put it back together.
      pendingCount,
    })
    .from(users)
    .where(
      and(
        searchTerm
          ? or(ilike(users.displayName, searchTerm), ilike(users.email, searchTerm))
          : undefined,
        query.role ? eq(users.role, query.role) : undefined,
        query.standing ? STANDING_FILTER[query.standing] : undefined,
      ),
    )
    .orderBy(...ORDER_BY[query.sort])
    .limit(query.limit)

  /**
   * After the read, never before, and without awaiting a failure into the
   * caller's lap: `recordAdminAction` swallows its own errors. The row records
   * that the roll was read and what it was narrowed to — not the addresses it
   * returned, which would put a copy of them in a second place for no gain.
   */
  await recordAdminAction({
    actorId: admin.id,
    action: 'accounts.viewed',
    subjectType: 'system',
    detail: {
      matched: rows.length,
      search: query.search ?? null,
      role: query.role ?? null,
      standing: query.standing ?? null,
    },
  })

  return {
    // `role`, `trustRevoked` and `approvedContributions` go over the wire
    // instead of a derived trust level, so the table applies `evaluateTrust`
    // itself and cannot disagree with the endpoints that queue an edit.
    accounts: rows.map((row) => ({
      ...row,
      bannedAt: row.bannedAt?.toISOString() ?? null,
      emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    })),
  }
})
