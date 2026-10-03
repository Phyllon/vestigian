import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'
import { passwordSchema } from '#shared/utils/password'

export const bodySchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
})

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Redeem a reset link and set a new password',
    description:
      'Does not sign in on success by design — resetting a password ends with a deliberate sign-in, not an automatic one from an emailed link.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const { token, password } = await readValidatedBody(event, bodySchema.parse)
  const database = useDatabase()

  // Joined rather than looked up afterwards: the confirmation mail below needs
  // the address and the name, and the token row already identifies the account.
  const [stored] = await database
    .select({
      id: emailTokens.id,
      userId: emailTokens.userId,
      expiresAt: emailTokens.expiresAt,
      consumedAt: emailTokens.consumedAt,
      email: users.email,
      displayName: users.displayName,
    })
    .from(emailTokens)
    .innerJoin(users, eq(users.id, emailTokens.userId))
    .where(
      and(eq(emailTokens.tokenHash, hashToken(token)), eq(emailTokens.purpose, 'reset-password')),
    )
    .limit(1)

  const check = checkToken(
    stored ? { expiresAt: stored.expiresAt, consumedAt: stored.consumedAt } : null,
  )

  if (!check.valid) {
    throw createError({
      statusCode: 400,
      message:
        check.reason === 'expired'
          ? 'That link has expired. Ask for a new one.'
          : 'That link is no longer valid.',
    })
  }

  const passwordHash = await hashPasswordArgon(password)

  await database.transaction(async (tx) => {
    const consumedAt = new Date()
    await tx.update(users).set({ passwordHash }).where(eq(users.id, stored!.userId))
    // Every outstanding reset link for this account is void, this one included,
    // so the second condition covers the first rather than repeating it.
    await tx
      .update(emailTokens)
      .set({ consumedAt })
      .where(
        and(
          eq(emailTokens.userId, stored!.userId),
          eq(emailTokens.purpose, 'reset-password'),
          isNull(emailTokens.consumedAt),
        ),
      )
  })

  /**
   * The one message nobody asks for and everybody needs. A password reset is
   * the last step of an account takeover as well as of a forgotten password,
   * and this is the only point at which the real owner finds out — the reset
   * link itself went to an inbox the attacker may already control, but this
   * lands after the fact and says what to do about it.
   */
  await sendAccountMail('password-changed', {
    to: stored!.email,
    displayName: stored!.displayName,
    siteUrl: useRuntimeConfig().public.siteUrl,
  })

  authEventsTotal().inc({ event: 'password-reset', outcome: 'accepted' })

  // The session is not created here on purpose: resetting a password should end
  // with a deliberate sign-in, not with an automatic one from an emailed link.
  return { status: 'reset' }
})
