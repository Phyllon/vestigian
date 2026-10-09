import { z } from 'zod'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'

export const changeEmailSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
})

/**
 * Starts a move to a new email address. **Nothing is written to `users` here.**
 *
 * The new address is parked on a `change-email` token and only becomes the
 * account's address when someone proves they can read that inbox, via
 * `auth/verify.post.ts`. Writing it immediately and clearing
 * `email_verified_at` would be simpler and much worse: a typo, or an address
 * typed into a borrowed session, would leave the real owner looking at an
 * account they can no longer sign in to and can no longer recover, because
 * `forgot-password` would now mail the wrong inbox.
 *
 * Two messages go out. The new address gets the link; the **old** address gets
 * a warning that a change was requested — which is the only signal reaching the
 * genuine owner when the session doing this is not theirs, and the reason the
 * old address is told before the change rather than after it.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Request a change of the signed-in account’s email address',
    description:
      'Requires the current password. Writes nothing to the account: the new address is held on a single-use token until it is confirmed from that inbox. The old address is warned that a change was requested.',
  },
})

export default defineEventHandler(async (event) => {
  const sessionUser = await requireActiveUser(event)
  await enforceRateLimit(event, 'passwordReset')

  const { currentPassword, email } = await readValidatedBody(event, changeEmailSchema.parse)

  if (await isDisposableEmailDomain(email)) {
    throw createError({
      statusCode: 400,
      message:
        'Temporary or disposable email addresses cannot be used. Please use a permanent address.',
      data: { field: 'email' },
    })
  }

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
    throw createError({ statusCode: 403, message: 'That is not your current password.' })
  }

  if (account.email === email) {
    throw createError({ statusCode: 400, message: 'That is already your address.' })
  }

  /**
   * A 409 here does reveal that some account holds the address — the same
   * trade `auth/register.post.ts` documents and for the same reason: the
   * alternative is a form that reports success and then silently never works.
   * The exposure is narrower than registration's, since reaching this line
   * costs a session *and* the account's current password.
   */
  const [taken] = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, sessionUser.id)))
    .limit(1)

  if (taken) {
    throw createError({ statusCode: 409, message: 'That address is already in use.' })
  }

  // Any earlier request is abandoned. Two live links to two different addresses
  // would mean whichever inbox answers last wins, which is not a race the
  // account holder should be able to lose.
  await database
    .update(emailTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailTokens.userId, sessionUser.id),
        eq(emailTokens.purpose, 'change-email'),
        isNull(emailTokens.consumedAt),
      ),
    )

  const issued = issueToken('change-email')

  await database.insert(emailTokens).values({
    userId: sessionUser.id,
    tokenHash: issued.tokenHash,
    purpose: 'change-email',
    newEmail: email,
    expiresAt: issued.expiresAt,
  })

  const siteUrl = useRuntimeConfig().public.siteUrl

  await sendTokenMail('change-email', {
    to: email,
    displayName: account.displayName,
    link: buildTokenLink(siteUrl, 'change-email', issued.token),
    expiresAt: issued.expiresAt,
  })

  /**
   * Sent regardless of `notify_by_email`, for the reason
   * `change-password.post.ts` sets out: an attacker holding a session could
   * otherwise switch the preference off first and take the address in silence.
   */
  await sendAccountMail('email-change-requested', {
    to: account.email,
    displayName: account.displayName,
    siteUrl,
  })

  event.context.log.info(
    { audit: 'auth.change-email-requested', userId: sessionUser.id },
    'address change requested',
  )

  return { status: 'pending-confirmation' as const }
})
