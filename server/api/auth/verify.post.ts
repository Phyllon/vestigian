import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'

export const bodySchema = z.object({ token: z.string().min(10).max(200) })

/**
 * Redeems an email verification token. The token is looked up by its hash, so
 * the raw value never exists in the database at any point.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Redeem an email verification token',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const { token } = await readValidatedBody(event, bodySchema.parse)
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
      and(eq(emailTokens.tokenHash, hashToken(token)), eq(emailTokens.purpose, 'verify-email')),
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
          ? 'That link has expired. Request a new one to continue.'
          : check.reason === 'already-used'
            ? 'That link has already been used. Try signing in.'
            : 'That link is not valid.',
    })
  }

  // Consuming the token and marking the address verified are one fact, so they
  // land together or not at all.
  await database.transaction(async (tx) => {
    const consumedAt = new Date()
    await tx.update(emailTokens).set({ consumedAt }).where(eq(emailTokens.id, stored!.id))
    await tx.update(users).set({ emailVerifiedAt: consumedAt }).where(eq(users.id, stored!.userId))
  })

  return { status: 'verified' }
})
