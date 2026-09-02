import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { revisions, users } from '~~/server/database/schema'

export const paramsSchema = z.object({ id: routeIdentifier })

// The same table twice, so each join needs its own name.
const author = alias(users, 'author')
const reviewer = alias(users, 'reviewer')

/**
 * The history of one tracing. Public, because a record whose provenance cannot be
 * inspected is a record no one should cite.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tracings'],
    summary: 'List the approved revision history of a tracing',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  await enforceRateLimit(event, 'recordDaily')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const database = useDatabase()

  const rows = await database
    .select({
      id: revisions.id,
      payload: revisions.payload,
      previousPayload: revisions.previousPayload,
      editSummary: revisions.editSummary,
      autoApproved: revisions.autoApproved,
      revertsRevisionId: revisions.revertsRevisionId,
      createdAt: revisions.createdAt,
      authorName: author.displayName,
      reviewerName: reviewer.displayName,
    })
    .from(revisions)
    .leftJoin(author, eq(author.id, revisions.authorId))
    .leftJoin(reviewer, eq(reviewer.id, revisions.reviewerId))
    .where(
      and(
        eq(revisions.entityType, 'tracing'),
        eq(revisions.entityId, id),
        eq(revisions.status, 'approved'),
      ),
    )
    .orderBy(desc(revisions.createdAt))
    .limit(100)

  return rows.map((row) => ({
    id: row.id,
    editSummary: row.editSummary,
    createdAt: row.createdAt.toISOString(),
    authorName: row.authorName,
    reviewerName: row.reviewerName,
    autoApproved: row.autoApproved === 1,
    isRevert: row.revertsRevisionId !== null,
    changes: diffPayloads(
      row.previousPayload as StoredPayload | null,
      row.payload as StoredPayload,
    ),
  }))
})
