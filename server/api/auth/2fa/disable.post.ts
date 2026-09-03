import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { twoFactorBackupCodes, users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const disableTwoFactorSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  code: z.string().min(6).max(9),
})

/**
 * Turns 2FA off. Requires **both** the current password (this project's
 * standing bar for any credential change — see `change-password.post.ts`)
 * **and** a working TOTP or backup code, since disabling a second factor is
 * itself a security-lowering action and deserves the stronger check, not the
 * weaker one either alone would be.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Turn off two-factor authentication',
    description:
      'Requires the current password and a working TOTP or backup code. Deletes the stored secret and every backup code.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'twoFactorVerify')

  const { currentPassword, code } = await readValidatedBody(event, disableTwoFactorSchema.parse)
  const database = useDatabase()

  const [account] = await database
    .select({
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      totpSecretEncrypted: users.totpSecretEncrypted,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  if (!account.totpEnabledAt || !account.totpSecretEncrypted) {
    throw createError({ statusCode: 409, message: 'Two-factor authentication is not on.' })
  }

  if (!(await verifyPasswordArgon(account.passwordHash, currentPassword))) {
    event.context.log.warn(
      { audit: 'auth.2fa-disable-refused', userId: sessionUser.id, reason: 'password' },
      'wrong password disabling 2fa',
    )
    throw createError({ statusCode: 403, message: 'That is not your current password.' })
  }

  if (!(await verifyTwoFactorCode(sessionUser.id, account.totpSecretEncrypted, code))) {
    event.context.log.warn(
      { audit: 'auth.2fa-disable-refused', userId: sessionUser.id, reason: 'code' },
      'wrong code disabling 2fa',
    )
    throw createError({ statusCode: 403, message: 'That code is not right.' })
  }

  await database.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpSecretEncrypted: null, totpEnabledAt: null })
      .where(eq(users.id, sessionUser.id))
    await tx.delete(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, sessionUser.id))
  })

  await sendAccountMail('two-factor-disabled', {
    to: account.email,
    displayName: account.displayName,
    siteUrl: useRuntimeConfig().public.siteUrl,
  })

  event.context.log.info({ audit: 'auth.2fa-disable', userId: sessionUser.id }, '2fa disabled')

  return { status: 'disabled' as const }
})
