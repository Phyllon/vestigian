import { z } from 'zod'
import { and, desc, eq, lt } from 'drizzle-orm'
import { revisions, sites, tracings, users } from '~~/server/database/schema'

export const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: routeIdentifier.optional(),
})

/**
 * What this account has submitted, newest first.
 *
 * The moderation queue orders oldest-first because it is a fairness ordering
 * over other people's work. This is the same table read the other way round:
 * someone looking at their own contributions wants the last thing they did.
 *
 * The point of it is the pending items. A contribution that goes into the queue
 * currently disappears — the map does not change, no page lists it, and the
 * only signal is an email that arrives whenever a moderator gets to it. This
 * shows it sitting there, with the reviewer's note once there is one, which is
 * the difference between a queue and silence.
 *
 * Rides the existing `revisions_author` index. The title is taken from the
 * revision's own payload rather than from the record it points at: a *pending*
 * revision that creates a new site has no `entity_id` yet — the row does not
 * exist until it is approved — so joining for the title left every queued item
 * reading "Untitled record", which is precisely the set this page exists to
 * show. The joins remain as a fallback for a revision whose payload predates a
 * field rename, and because a published record may since have been retitled.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'The signed-in account’s own contributions',
    description:
      'Every revision the caller authored, newest first, with its status, the reviewer’s note where one exists, and the title of the record it touched. Cursor-paged.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'record')

  const { limit, cursor } = await getValidatedQuery(event, querySchema.parse)

  const rows = await useDatabase()
    .select({
      id: revisions.id,
      entityType: revisions.entityType,
      entityId: revisions.entityId,
      status: revisions.status,
      payload: revisions.payload,
      editSummary: revisions.editSummary,
      reviewNote: revisions.reviewNote,
      autoApproved: revisions.autoApproved,
      revertsRevisionId: revisions.revertsRevisionId,
      createdAt: revisions.createdAt,
      reviewedAt: revisions.reviewedAt,
      reviewerName: users.displayName,
      siteTitle: sites.title,
      siteSlug: sites.slug,
      tracingTitle: tracings.title,
    })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.reviewerId))
    .leftJoin(sites, and(eq(revisions.entityType, 'site'), eq(sites.id, revisions.entityId)))
    .leftJoin(
      tracings,
      and(eq(revisions.entityType, 'tracing'), eq(tracings.id, revisions.entityId)),
    )
    .where(and(eq(revisions.authorId, userId), cursor ? lt(revisions.id, cursor) : undefined))
    .orderBy(desc(revisions.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)

  return {
    items: page.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      status: row.status,
      title:
        (row.payload as { title?: string } | null)?.title ??
        row.siteTitle ??
        row.tracingTitle ??
        null,
      slug: row.siteSlug ?? null,
      editSummary: row.editSummary,
      reviewNote: row.reviewNote,
      reviewerName: row.reviewerName,
      /**
       * `autoApproved` is stored as an integer flag. Surfaced as a boolean so
       * the page can say "published straight away" rather than showing a
       * moderator's name that does not exist.
       */
      autoApproved: row.autoApproved === 1,
      isRevert: row.revertsRevisionId !== null,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
    })),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  }
})
