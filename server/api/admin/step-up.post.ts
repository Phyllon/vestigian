import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'

export const stepUpSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  /** Required when the account has two-factor on. TOTP or a backup code. */
  code: z.string().min(6).max(9).optional(),
})

/**
 * Proves the administrator at the keyboard is the account holder, now.
 *
 * Holding an admin session is enough to *read* the panel. It is deliberately
 * not enough to promote another account to administrator or to lock someone
 * out, because those are the two actions this application cannot undo from
 * inside itself: `checkRoleChange` refuses to demote an admin
 * unconditionally, so a second permanent administrator minted from a stolen
 * session can only be removed with direct database access. Asking for the
 * password again at that moment is what turns a captured session from full
 * capture into read-only reconnaissance.
 *
 * A backup code is accepted as well as a TOTP code. Refusing one would mean an
 * administrator whose phone is in the sea could not act at all, and the code
 * is single-use either way — the cost of spending one here is a code, not an
 * account.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Re-authenticate to unlock privileged admin actions',
    description:
      'Admin only. Takes the current password, plus a TOTP or backup code when the account has two-factor on. Mints a grant bound to this one session for fifteen minutes; role changes and blocks refuse with 428 until it is held.',
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await enforceRateLimit(event, 'adminStepUp')
  const { currentPassword, code } = await readValidatedBody(event, stepUpSchema.parse)
  const database = useDatabase()

  const [account] = await database
    .select({
      passwordHash: users.passwordHash,
      totpSecretEncrypted: users.totpSecretEncrypted,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, admin.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  if (!(await verifyPasswordArgon(account.passwordHash, currentPassword))) {
    event.context.log.warn(
      { audit: 'admin.step-up-refused', userId: admin.id, reason: 'password' },
      'wrong password confirming admin action',
    )
    throw createError({ statusCode: 403, message: 'That is not your current password.' })
  }

  /**
   * The stronger bar when a second factor exists, the same way
   * `2fa/disable.post.ts` demands both rather than either: a password alone
   * would make this endpoint the softest door onto an account that has
   * deliberately made its front door harder.
   */
  if (account.totpEnabledAt && account.totpSecretEncrypted) {
    if (!code) {
      throw createError({
        statusCode: 400,
        message: 'Enter a code from your authenticator app.',
        data: { field: 'code' },
      })
    }

    if (!(await verifyTwoFactorCode(admin.id, account.totpSecretEncrypted, code))) {
      event.context.log.warn(
        { audit: 'admin.step-up-refused', userId: admin.id, reason: 'code' },
        'wrong code confirming admin action',
      )
      throw createError({ statusCode: 403, message: 'That code is not right.' })
    }
  }

  const expiresInSeconds = await grantStepUp(event, admin)

  await recordAdminAction({
    actorId: admin.id,
    action: 'step-up.granted',
    subjectType: 'system',
    detail: { twoFactor: account.totpEnabledAt !== null },
  })

  event.context.log.info({ audit: 'admin.step-up', userId: admin.id }, 'admin action confirmed')

  return { status: 'confirmed' as const, expiresInSeconds }
})
