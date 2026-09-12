import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { checkBan, describeBanRejection } from '#shared/utils/authorization'

export const banSchema = z.object({
  userId: databaseIdentifier,
  blocked: z.boolean(),
  /** Sent to the person, and the only part of a block they can act on. */
  reason: z.string().trim().max(300).optional(),
})

/**
 * Blocks an account, or lifts a block.
 *
 * A block is a sanction on the **person**, not on their work: login is
 * refused, every live session ends, and every write is refused, while the
 * sites, tracings, photographs and revision history they contributed stay
 * exactly where they are and stay credited to them. Taking that work offline
 * is a separate, counted, reversible action (`admin/retract.post.ts`), chosen
 * deliberately rather than triggered as a side effect — a block that silently
 * unpublished a productive contributor's back catalogue would be a much larger
 * decision than the button implies, and one a lifted block could not undo.
 *
 * Three things make it bite where trust revocation does not. `banned_at` is
 * read inside `readCurrentIdentity`, so every guarded route refuses on the
 * next request. `sessions_valid_from` is bumped, which is the only revocation
 * a stateless sealed session can have — without it a block would wait for the
 * person to log out, which is precisely when they have no reason to. And
 * `login.post.ts` refuses below the credential check, so the endpoint adds no
 * way to discover whether an address is registered or blocked.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Block an account, or lift a block',
    description:
      'Admin only, and requires re-authentication (428 until a step-up grant is held). Never permitted against another administrator — the same rule that forbids demoting one. Ends every live session and mails the account holder. Published contributions are untouched.',
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await enforceRateLimit(event, 'contribute')
  const { userId, blocked, reason } = await readValidatedBody(event, banSchema.parse)
  const database = useDatabase()

  const [target] = await database
    .select({
      id: users.id,
      role: users.role,
      email: users.email,
      displayName: users.displayName,
      bannedAt: users.bannedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, message: 'No such account.' })

  const check = checkBan({ actor: admin, targetUserId: userId, targetCurrentRole: target.role })

  if (!check.allowed) {
    throw createError({ statusCode: 403, message: describeBanRejection(check.reason!) })
  }

  if (blocked === (target.bannedAt !== null)) {
    throw createError({
      statusCode: 409,
      message: blocked ? 'That account is already blocked.' : 'That account is not blocked.',
    })
  }

  // After the rules, before the write: a refused sanction should not have cost
  // the administrator their password, and a confirmed one should not be
  // reusable for a second unrelated action.
  await requireStepUp(event, admin)

  const now = new Date()

  await database
    .update(users)
    .set({
      bannedAt: blocked ? now : null,
      banReason: blocked ? (reason ?? null) : null,
      bannedBy: blocked ? admin.id : null,
      /**
       * Bumped in both directions. Blocking ends their sessions, which is the
       * point; unblocking bumps it too, so a cookie that was live at the
       * moment of the block cannot come back to life when it is lifted. Making
       * someone sign in again is a trivial cost against a session that spent
       * time in an invalid state.
       */
      sessionsValidFrom: now,
    })
    .where(eq(users.id, userId))

  await consumeStepUp(event, admin)

  /**
   * After the write and never before, per the standing rule that a decision
   * reaches the person it was made about — and regardless of
   * `notify_by_email`, for the reason `change-password.post.ts` gives: a
   * preference must not be able to make a security decision silent. Mail never
   * throws, so a provider outage cannot turn a block that has already happened
   * into a 500 that suggests it has not.
   */
  await sendAccountMail(blocked ? 'account-blocked' : 'account-unblocked', {
    to: target.email,
    displayName: target.displayName,
    siteUrl: useRuntimeConfig().public.siteUrl,
    moderatorName: admin.displayName,
    note: reason ?? null,
  })

  await recordAdminAction({
    actorId: admin.id,
    action: blocked ? 'account.banned' : 'account.unbanned',
    subjectType: 'account',
    subjectId: userId,
    detail: { reason: reason ?? null, targetRole: target.role },
  })

  moderationActionsTotal().inc({ action: blocked ? 'ban' : 'unban' })
  event.context.log.warn(
    {
      audit: 'admin.ban',
      targetUserId: userId,
      blocked,
      actorId: admin.id,
    },
    blocked ? 'account blocked' : 'account unblocked',
  )

  return { userId, blocked, bannedAt: blocked ? now.toISOString() : null }
})
