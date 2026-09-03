import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const verifyTwoFactorSchema = z.object({
  challengeId: z.string().min(1).max(64),
  code: z.string().min(6).max(9),
})

interface ChallengeState {
  userId: number
  attempts: number
}

/**
 * Completes a login that `login.post.ts` left pending on a second factor.
 *
 * This is the only other place `setUserSession` is called — the login route
 * itself calls it once for a single-factor account, this route calls it
 * once for a two-factor one, and nothing else in the app ever does. The
 * challenge is invalidated outright after `MAX_CHALLENGE_ATTEMPTS` wrong
 * codes, on top of the IP-wide `twoFactorVerify` rate limit: a 6-digit code
 * is a smaller space than a password, so it gets the tighter of the two
 * guards, not just one of them.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Complete a two-factor login',
    description:
      'Redeems the challengeId from a login response that returned requiresTwoFactor, with a TOTP or backup code. Sets the session cookie on success.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'twoFactorVerify')

  const { challengeId, code } = await readValidatedBody(event, verifyTwoFactorSchema.parse)
  const redis = useRedis()
  const key = loginChallengeKey(challengeId)

  const raw = await redis.get(key)
  if (!raw) {
    throw createError({
      statusCode: 401,
      message: 'That sign-in attempt has expired. Sign in again.',
    })
  }

  const state = JSON.parse(raw) as ChallengeState
  const database = useDatabase()

  const [account] = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      totpSecretEncrypted: users.totpSecretEncrypted,
    })
    .from(users)
    .where(eq(users.id, state.userId))
    .limit(1)

  // Reachable if 2FA was turned off in the few minutes since this challenge
  // was issued — treat it the same as an expired challenge rather than a
  // crash, since the reader still needs to just sign in again.
  if (!account || !account.totpSecretEncrypted) {
    await redis.del(key)
    throw createError({
      statusCode: 401,
      message: 'That sign-in attempt has expired. Sign in again.',
    })
  }

  if (await verifyTwoFactorCode(account.id, account.totpSecretEncrypted, code)) {
    await redis.del(key)

    authEventsTotal().inc({ event: 'login', outcome: 'accepted' })
    event.context.log.info(
      { audit: 'auth.login', userId: account.id, role: account.role },
      'signed in with second factor',
    )

    const user: SessionUser = {
      id: account.id,
      displayName: account.displayName,
      role: account.role,
      trustRevoked: account.trustRevoked,
      approvedContributions: account.approvedContributions,
    }

    await setUserSession(event, { user, loggedInAt: Date.now() })
    await database.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, account.id))

    return { user }
  }

  const attempts = state.attempts + 1

  if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await redis.del(key)
    authEventsTotal().inc({ event: 'login', outcome: 'rejected' })
    event.context.log.warn(
      { audit: 'auth.login', userId: account.id },
      '2fa challenge invalidated after repeated wrong codes',
    )
    throw createError({
      statusCode: 401,
      message: 'Too many wrong codes. Sign in again from the start.',
    })
  }

  // TTL is reset to whatever remains rather than restarted, so repeated wrong
  // guesses cannot be used to keep a challenge alive indefinitely.
  const remainingTtl = await redis.ttl(key)
  await redis.set(
    key,
    JSON.stringify({ userId: state.userId, attempts } satisfies ChallengeState),
    'EX',
    Math.max(remainingTtl, 1),
  )

  authEventsTotal().inc({ event: 'login', outcome: 'rejected' })
  event.context.log.warn({ audit: 'auth.login', userId: account.id }, 'wrong second-factor code')
  throw createError({ statusCode: 401, message: 'That code is not right.' })
})
