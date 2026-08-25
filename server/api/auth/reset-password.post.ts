import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'
import { passwordSchema } from '#shared/utils/password'

const bodySchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const { token, password } = await readValidatedBody(event, bodySchema.parse)
  const database = useDatabase()

  const [stored] = await database
    .select({
      id: emailTokens.id,
      userId: emailTokens.userId,
      expiresAt: emailTokens.expiresAt,
      consumedAt: emailTokens.consumedAt,
    })
    .from(emailTokens)
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

  // The session is not created here on purpose: resetting a password should end
  // with a deliberate sign-in, not with an automatic one from an emailed link.
  return { status: 'reset' }
})
