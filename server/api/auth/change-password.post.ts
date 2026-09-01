import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { passwordSchema } from '#shared/utils/password'
import type { SessionUser } from '#shared/types'

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  password: passwordSchema,
})

/**
 * Changes the password of a signed-in account.
 *
 * Until now the only route to a new password was `forgot-password` — which
 * means the one way to rotate a credential was to have a single-use key mailed
 * to you, and someone who simply wanted to change their password had to
 * pretend to have lost it.
 *
 * The current password is required. A session cookie is bearer proof of a past
 * sign-in, not present possession of the credential, so without this check a
 * borrowed laptop or a stolen cookie is enough to lock the owner out — which is
 * strictly worse than the reset flow it replaces, where the attacker at least
 * needs the inbox.
 *
 * The owner is mailed afterwards, for the reason `reset-password.post.ts`
 * records: a password change is the last step of a takeover as often as it is
 * routine hygiene, and the message is the only thing that reaches the real
 * owner. It is sent **regardless of `notify_by_email`** — see the comment
 * below.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Change the signed-in account’s password',
    description:
      'Requires the current password: a session proves a past sign-in, not present possession of the credential. Notifies the account owner afterwards.',
  },
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser
  // The login bucket, not the profile one: this endpoint verifies a password,
  // so it is a credential-guessing surface and belongs behind the same limit.
  await enforceRateLimit(event, 'login')

  const { currentPassword, password } = await readValidatedBody(event, changePasswordSchema.parse)
  const database = useDatabase()

  const [account] = await database
    .select({
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!account) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  if (!(await verifyPasswordArgon(account.passwordHash, currentPassword))) {
    event.context.log.warn(
      { audit: 'auth.change-password-refused', userId: sessionUser.id },
      'current password did not match',
    )
    throw createError({ statusCode: 403, message: 'That is not your current password.' })
  }

  await database
    .update(users)
    .set({ passwordHash: await hashPasswordArgon(password) })
    .where(eq(users.id, sessionUser.id))

  /**
   * Not gated on `notify_by_email`. That preference covers review decisions and
   * trust changes — messages about the reader's contributions, which they may
   * reasonably not want. This one is a security notice about the credential
   * itself, and an attacker who has a session can set the preference to false
   * before changing the password, which would turn the switch into a way to
   * silence the only warning the owner gets.
   */
  await sendAccountMail('password-changed', {
    to: account.email,
    displayName: account.displayName,
    siteUrl: useRuntimeConfig().public.siteUrl,
  })

  event.context.log.info(
    { audit: 'auth.change-password', userId: sessionUser.id },
    'password changed',
  )

  return { status: 'changed' as const }
})
