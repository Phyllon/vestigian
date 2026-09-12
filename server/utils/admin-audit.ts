import { adminAuditLog } from '~~/server/database/schema'
import type { AdminAction, AdminSubjectType } from '#shared/utils/authorization'

export interface AdminAuditEntry {
  actorId: number
  action: AdminAction
  subjectType: AdminSubjectType
  subjectId?: number | null
  /** What was decided. Never a credential, never an IP — see the schema note. */
  detail?: Record<string, unknown>
}

/**
 * Writes one row to the admin audit trail.
 *
 * Called **after** the action it describes has been applied, never before, for
 * the same reason the notification rule gives: a log line claiming a decision
 * that then failed is worse than a missing one. And it never throws — a write
 * here must not be able to undo a ban that has already taken effect, so a
 * failure lands in the request log (where the same `audit:` line already goes)
 * and the action stands. That is a deliberate trade: the trail can have a hole
 * in it during a Postgres problem, but it cannot roll back a governance
 * decision.
 */
export const recordAdminAction = async (entry: AdminAuditEntry): Promise<void> => {
  try {
    await useDatabase()
      .insert(adminAuditLog)
      .values({
        actorId: entry.actorId,
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId ?? null,
        detail: entry.detail ?? null,
      })
  } catch (error) {
    useLogger().error(
      {
        audit: 'admin.audit-write-failed',
        action: entry.action,
        actorId: entry.actorId,
        err: { message: (error as Error).message },
      },
      'admin audit row could not be written',
    )
  }
}
