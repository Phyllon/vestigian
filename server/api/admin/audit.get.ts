import { z } from 'zod'
import { and, desc, eq, lt } from 'drizzle-orm'
import { adminAuditLog, users } from '~~/server/database/schema'
import { ADMIN_ACTIONS } from '#shared/utils/authorization'

export const querySchema = z.object({
  action: z.enum(ADMIN_ACTIONS).optional(),
  // Query parameters always arrive as strings — see the same fix in
  // `admin/activity.get.ts`'s `authorId`, found by the same failing e2e test
  // exercising `activity.get.ts`; `databaseIdentifier` has no coercion and
  // would 400 on every real request here too.
  actorId: routeIdentifier.optional(),
  subjectType: z.enum(['account', 'revision', 'image', 'system']).optional(),
  subjectId: routeIdentifier.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: routeIdentifier.optional(),
})

/**
 * Who did what in here.
 *
 * The panel's own accountability, and the thing that makes the rest of it
 * defensible: an administrator can read every registered email address and
 * lock people out, and "tough security" that nobody can inspect afterwards is
 * a claim rather than a property. It is also, deliberately, a surface an
 * administrator cannot edit — `recordAdminAction` only ever inserts, and
 * nothing in the application updates or deletes a row here.
 *
 * `action` is typed off `ADMIN_ACTIONS` rather than accepting free text, so a
 * filter in the panel and the endpoint that writes the row cannot drift into
 * disagreeing about what an action is called.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'The admin audit trail, newest first',
    description:
      'Admin only. Append-only: nothing in the application updates or deletes an entry. Holds no IP addresses and no credentials — request-level detail lives in the request log on its own retention.',
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await enforceRateLimit(event, 'admin')
  const query = await getValidatedQuery(event, querySchema.parse)
  const database = useDatabase()

  const rows = await database
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      subjectType: adminAuditLog.subjectType,
      subjectId: adminAuditLog.subjectId,
      detail: adminAuditLog.detail,
      createdAt: adminAuditLog.createdAt,
      actorId: adminAuditLog.actorId,
      actorName: users.displayName,
    })
    .from(adminAuditLog)
    // Left, not inner: an administrator exercising their own right to erasure
    // does not take the record of their decisions with them.
    .leftJoin(users, eq(users.id, adminAuditLog.actorId))
    .where(
      and(
        query.action ? eq(adminAuditLog.action, query.action) : undefined,
        query.actorId ? eq(adminAuditLog.actorId, query.actorId) : undefined,
        query.subjectType ? eq(adminAuditLog.subjectType, query.subjectType) : undefined,
        query.subjectId ? eq(adminAuditLog.subjectId, query.subjectId) : undefined,
        query.cursor ? lt(adminAuditLog.id, query.cursor) : undefined,
      ),
    )
    .orderBy(desc(adminAuditLog.id))
    .limit(query.limit)

  return {
    entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length === query.limit ? rows.at(-1)!.id : null,
  }
})
