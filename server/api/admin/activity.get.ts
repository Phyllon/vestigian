import { z } from 'zod'
import { and, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm'
import { revisions, users } from '~~/server/database/schema'

export const querySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  entityType: z.enum(['site', 'tracing']).optional(),
  authorId: databaseIdentifier.optional(),
  /** Only edits that published without a moderator ever seeing them. */
  autoApprovedOnly: z.coerce.boolean().optional(),
  /** Only edits that remove more than they add (`isBlankingEdit`). */
  blankingOnly: z.coerce.boolean().optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  /** Matches the record's title and the author's own edit summary. */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: routeIdentifier.optional(),
})

/**
 * Every revision the atlas has, newest first — the answer to "what changed".
 *
 * `moderation/queue.get.ts` filters `status = 'pending'`, which is correct for
 * a work queue and is precisely why nothing in this application could see an
 * auto-approved edit. The moment a contributor crosses `TRUST_THRESHOLD` their
 * work publishes directly and leaves that queue empty; `applyRevision()` logs
 * every one of those writes, but that line goes to Loki, so the only way to
 * review a trusted contributor's edits was to read the request log. This is
 * the same projection the queue builds — author, diff, blanking and
 * substantial flags — over the whole table rather than one status.
 *
 * Filtering is server-side and deliberately so: narrowing a page of thirty
 * results in the browser would report "no matches" for a term that is sitting
 * on page four.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Every revision, newest first, whatever its status',
    description:
      'Admin only. Unlike the moderation queue this is not restricted to pending work, so auto-approved edits from trusted contributors are visible here and nowhere else in the application.',
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await enforceRateLimit(event, 'admin')
  const query = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const searchTerm = query.q ? `%${query.q}%` : null

  const rows = await database
    .select({
      id: revisions.id,
      entityType: revisions.entityType,
      entityId: revisions.entityId,
      payload: revisions.payload,
      previousPayload: revisions.previousPayload,
      editSummary: revisions.editSummary,
      status: revisions.status,
      autoApproved: revisions.autoApproved,
      revertsRevisionId: revisions.revertsRevisionId,
      createdAt: revisions.createdAt,
      reviewedAt: revisions.reviewedAt,
      reviewNote: revisions.reviewNote,
      authorId: revisions.authorId,
      // Left, not inner: a contribution outlives the account that made it.
      authorName: users.displayName,
      authorRole: users.role,
      authorBannedAt: users.bannedAt,
    })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.authorId))
    .where(
      and(
        query.status ? eq(revisions.status, query.status) : undefined,
        query.entityType ? eq(revisions.entityType, query.entityType) : undefined,
        query.authorId ? eq(revisions.authorId, query.authorId) : undefined,
        query.autoApprovedOnly ? eq(revisions.autoApproved, 1) : undefined,
        query.since ? gte(revisions.createdAt, query.since) : undefined,
        query.until ? lte(revisions.createdAt, query.until) : undefined,
        // The title lives inside the jsonb payload; only that one accessor is
        // raw, which is the line `.claude/rules/data-clients.md` draws.
        searchTerm
          ? or(
              sql`${revisions.payload}->>'title' ILIKE ${searchTerm}`,
              sql`${revisions.editSummary} ILIKE ${searchTerm}`,
            )
          : undefined,
        // Descending order, so the cursor walks backwards.
        query.cursor ? lt(revisions.id, query.cursor) : undefined,
      ),
    )
    .orderBy(desc(revisions.id))
    .limit(query.limit)

  const items = rows
    .map((row) => {
      const changes = diffPayloads(
        row.previousPayload as StoredPayload | null,
        row.payload as StoredPayload,
      )

      return {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        title: (row.payload as { title?: string }).title ?? null,
        editSummary: row.editSummary,
        status: row.status,
        /**
         * The distinction the whole endpoint exists for: `autoApproved` means
         * this went live on the trust rule alone, with no human decision
         * behind it.
         */
        autoApproved: row.autoApproved === 1,
        isRevert: row.revertsRevisionId !== null,
        /** A retraction is an ordinary revision; this is how it reads as one. */
        isRetraction: (row.payload as { retracted?: boolean }).retracted === true,
        changes,
        substantial: isSubstantialEdit(changes),
        blanking: isBlankingEdit(changes),
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        reviewNote: row.reviewNote,
        authorId: row.authorId,
        authorName: row.authorName,
        authorRole: row.authorRole,
        authorBanned: row.authorBannedAt !== null,
      }
    })
    /**
     * Applied after the diff rather than in SQL, because whether an edit is a
     * blanking edit is `isBlankingEdit`'s judgement over the computed changes
     * and not a column — the same reason the queue surfaces it rather than
     * ordering by it. The cost is that a page can come back shorter than the
     * limit when this filter is on; `nextCursor` still walks correctly,
     * because it is taken from the unfiltered rows below.
     */
    .filter((item) => (query.blankingOnly ? item.blanking : true))

  return {
    items,
    nextCursor: rows.length === query.limit ? rows[rows.length - 1]!.id : null,
  }
})
