import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

/**
 * Generates a fresh TOTP secret for the signed-in account, without enabling
 * anything yet.
 *
 * The secret is held in Valkey, not written to `users`, until
 * `enable.post.ts` sees a code that proves the authenticator app actually
 * has it. A secret persisted the moment it's generated could be switched on
 * by a scan that never happened — this account's owner clicking "enable"
 * and closing the tab before finishing would otherwise leave 2FA silently
 * armed with a secret nobody's app holds, locking them out on the next
 * sign-in.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Begin two-factor enrollment',
    description:
      'Generates a TOTP secret held in cache for 10 minutes, not yet persisted. Returns a QR code and manual-entry key; confirm with a code via /api/auth/2fa/enable to actually turn it on.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  await enforceRateLimit(event, 'passwordReset')

  const database = useDatabase()
  const [account] = await database
    .select({ email: users.email, totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  if (account.totpEnabledAt) {
    throw createError({
      statusCode: 409,
      message: 'Two-factor authentication is already on. Turn it off before setting it up again.',
    })
  }

  const enrollment = await generatePendingTotpEnrollment(account.email)

  await useRedis().set(
    pendingEnrollmentKey(sessionUser.id),
    enrollment.secretBase32,
    'EX',
    PENDING_ENROLLMENT_TTL_SECONDS,
  )

  event.context.log.info({ audit: 'auth.2fa-setup', userId: sessionUser.id }, '2fa setup started')

  return {
    secret: enrollment.secretBase32,
    otpauthUri: enrollment.otpauthUri,
    qrCode: enrollment.qrCodeDataUri,
    expiresInSeconds: PENDING_ENROLLMENT_TTL_SECONDS,
  }
})
