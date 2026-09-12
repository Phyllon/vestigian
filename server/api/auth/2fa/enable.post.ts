import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { twoFactorBackupCodes, users } from '~~/server/database/schema'

export const enableTwoFactorSchema = z.object({
  code: z.string().min(6).max(6),
})

/**
 * Confirms the code an authenticator app just produced from the secret
 * `setup.post.ts` handed out, and only on success turns 2FA on.
 *
 * This is the one place a `users.totp_secret_encrypted` value is ever
 * written — matching the project's "one writer" shape for anything that
 * changes account standing (`applyRevision` for content,
 * `change-password.post.ts` for the password). Ten backup codes are
 * generated in the same request and returned once, in plain text; only
 * their hashes are stored, exactly like `emailTokens`.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Confirm two-factor enrollment',
    description:
      'Verifies a code against the pending secret from /api/auth/2fa/setup, then persists it and issues 10 backup codes, shown once in the response.',
  },
})

export default defineEventHandler(async (event) => {
  const sessionUser = await requireActiveUser(event)
  await enforceRateLimit(event, 'twoFactorVerify')

  const { code } = await readValidatedBody(event, enableTwoFactorSchema.parse)
  const database = useDatabase()

  const pendingSecret = await useRedis().get(pendingEnrollmentKey(sessionUser.id))
  if (!pendingSecret) {
    throw createError({
      statusCode: 400,
      message: 'That setup has expired. Start again from the settings page.',
    })
  }

  if (!verifyTotpCode(pendingSecret, code)) {
    event.context.log.warn(
      { audit: 'auth.2fa-enable-refused', userId: sessionUser.id },
      'wrong code confirming 2fa setup',
    )
    throw createError({ statusCode: 403, message: 'That code is not right. Try again.' })
  }

  const [account] = await database
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  const backupCodes = generateBackupCodes()

  await database.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        totpSecretEncrypted: encryptTotpSecret(pendingSecret),
        totpEnabledAt: new Date(),
      })
      .where(eq(users.id, sessionUser.id))

    await tx.insert(twoFactorBackupCodes).values(
      backupCodes.map((plainCode) => ({
        userId: sessionUser.id,
        codeHash: hashToken(plainCode),
      })),
    )
  })

  await useRedis().del(pendingEnrollmentKey(sessionUser.id))

  await sendAccountMail('two-factor-enabled', {
    to: account.email,
    displayName: account.displayName,
    siteUrl: useRuntimeConfig().public.siteUrl,
  })

  event.context.log.info({ audit: 'auth.2fa-enable', userId: sessionUser.id }, '2fa enabled')

  return { status: 'enabled' as const, backupCodes }
})
