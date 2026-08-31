import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'

export const bodySchema = z.object({ email: z.string().email().max(320) })

/**
 * Always answers the same way, whether or not the address has an account.
 * Anything else turns this endpoint into a way to test which addresses are
 * registered here.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Request a password reset link',
    description:
      'Answers identically whether or not the address has an account, so the response cannot be used to enumerate registered emails.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'passwordReset')
  const { email } = await readValidatedBody(event, bodySchema.parse)
  const database = useDatabase()
  const config = useRuntimeConfig()

  // `lower(email)` to match the unique index — see the note in login.post.ts.
  const [account] = await database
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1)

  if (account) {
    const issued = issueToken('reset-password')

    await database.insert(emailTokens).values({
      userId: account.id,
      tokenHash: issued.tokenHash,
      purpose: 'reset-password',
      expiresAt: issued.expiresAt,
    })

    await sendTokenMail('reset-password', {
      to: email,
      displayName: account.displayName,
      link: buildTokenLink(config.public.siteUrl, 'reset-password', issued.token),
      expiresAt: issued.expiresAt,
    })
  }

  return { status: 'sent' }
})
