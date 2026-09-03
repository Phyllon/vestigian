import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { twoFactorBackupCodes, users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const regenerateBackupCodesSchema = z.object({
  currentPassword: z.string().min(1).max(200),
})

/**
 * Replaces the whole set of backup codes — every old one stops working,
 * including any never used, not only the ones already consumed. Requires
 * the current password, the same bar `change-password.post.ts` sets for any
 * credential change; no second code is asked for here, since a working
 * TOTP code is not needed to prove "I still hold the account", only the
 * password is.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Regenerate two-factor backup codes',
    description:
      'Requires the current password. Invalidates every existing backup code and issues 10 new ones, shown once in the response.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'passwordReset')

  const { currentPassword } = await readValidatedBody(event, regenerateBackupCodesSchema.parse)
  const database = useDatabase()

  const [account] = await database
    .select({
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  if (!account.totpEnabledAt) {
    throw createError({ statusCode: 409, message: 'Two-factor authentication is not on.' })
  }

  if (!(await verifyPasswordArgon(account.passwordHash, currentPassword))) {
    event.context.log.warn(
      { audit: 'auth.2fa-backup-codes-refused', userId: sessionUser.id },
      'wrong password regenerating backup codes',
    )
    throw createError({ statusCode: 403, message: 'That is not your current password.' })
  }

  const backupCodes = generateBackupCodes()

  await database.transaction(async (tx) => {
    await tx.delete(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, sessionUser.id))
    await tx.insert(twoFactorBackupCodes).values(
      backupCodes.map((plainCode) => ({
        userId: sessionUser.id,
        codeHash: hashToken(plainCode),
      })),
    )
  })

  await sendAccountMail('two-factor-backup-codes-regenerated', {
    to: account.email,
    displayName: account.displayName,
    siteUrl: useRuntimeConfig().public.siteUrl,
  })

  event.context.log.info(
    { audit: 'auth.2fa-backup-codes', userId: sessionUser.id },
    'backup codes regenerated',
  )

  return { status: 'regenerated' as const, backupCodes }
})
