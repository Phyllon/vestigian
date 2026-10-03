import { z } from 'zod'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'

export const bodySchema = z.object({ token: z.string().min(10).max(200) })

const TOKEN_ERROR_MESSAGES: Record<'expired' | 'already-used' | 'unknown', string> = {
  expired: 'That link has expired. Request a new one to continue.',
  'already-used': 'That link has already been used. Try signing in.',
  unknown: 'That link is not valid.',
}

/**
 * Redeems a token that proves someone can read an inbox. The token is looked up
 * by its hash, so the raw value never exists in the database at any point.
 *
 * Two purposes land here, because from the recipient's side they ask the same
 * thing — *confirm that this address is yours*. `verify-email` finishes a
 * signup; `change-email` moves an existing account to a new address it has been
 * holding on the token (see `auth/change-email.post.ts` for why it is held
 * there rather than written to `users` up front). Which one this is comes from
 * the stored row, never from the request, so a caller cannot pick.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Redeem an address-confirmation token',
    description:
      'Finishes a signup or completes a requested change of address, depending on the token’s stored purpose. Single use.',
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
      purpose: emailTokens.purpose,
      newEmail: emailTokens.newEmail,
      expiresAt: emailTokens.expiresAt,
      consumedAt: emailTokens.consumedAt,
    })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        inArray(emailTokens.purpose, ['verify-email', 'change-email']),
      ),
    )
    .limit(1)

  const check = checkToken(
    stored ? { expiresAt: stored.expiresAt, consumedAt: stored.consumedAt } : null,
  )

  if (!check.valid) {
    throw createError({
      statusCode: 400,
      message: TOKEN_ERROR_MESSAGES[check.reason ?? 'unknown'],
    })
  }

  const confirmed = stored!
  const isAddressChange = confirmed.purpose === 'change-email'

  /**
   * Checked here rather than only at request time: a token can sit in an inbox
   * for hours, and in that window someone else may register the address. Taking
   * it now would leave two accounts sharing one address, past the unique index,
   * as a failed insert rather than a message anyone can act on.
   */
  if (isAddressChange && confirmed.newEmail) {
    const [taken] = await database
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, confirmed.newEmail), ne(users.id, confirmed.userId)))
      .limit(1)

    if (taken) {
      throw createError({
        statusCode: 409,
        message: 'That address was claimed by another account in the meantime.',
      })
    }
  }

  // Consuming the token and writing what it proves are one fact, so they land
  // together or not at all.
  await database.transaction(async (tx) => {
    const consumedAt = new Date()
    await tx.update(emailTokens).set({ consumedAt }).where(eq(emailTokens.id, confirmed.id))
    await tx
      .update(users)
      .set({
        emailVerifiedAt: consumedAt,
        ...(isAddressChange && confirmed.newEmail ? { email: confirmed.newEmail } : {}),
      })
      .where(eq(users.id, confirmed.userId))
  })

  event.context.log.info(
    { audit: isAddressChange ? 'auth.email-changed' : 'auth.verified', userId: confirmed.userId },
    isAddressChange ? 'address change confirmed' : 'address verified',
  )

  authEventsTotal().inc({
    event: isAddressChange ? 'email-change' : 'email-verify',
    outcome: 'accepted',
  })

  return { status: isAddressChange ? ('address-changed' as const) : ('verified' as const) }
})
