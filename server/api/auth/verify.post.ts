import { z } from 'zod'

const bodySchema = z.object({ token: z.string().min(10).max(200) })

/**
 * Redeems an email verification token. The token is looked up by its hash, so
 * the raw value never exists in the database at any point.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const { token } = await readValidatedBody(event, bodySchema.parse)
  const sql = useSql()

  const [stored] = await sql<
    { id: number; user_id: number; expires_at: Date; consumed_at: Date | null }[]
  >`
    SELECT id, user_id, expires_at, consumed_at
    FROM email_tokens
    WHERE token_hash = ${hashToken(token)} AND purpose = 'verify-email'
    LIMIT 1
  `

  const check = checkToken(
    stored ? { expiresAt: stored.expires_at, consumedAt: stored.consumed_at } : null,
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

  await sql.begin(async (tx) => {
    await tx`UPDATE email_tokens SET consumed_at = now() WHERE id = ${stored!.id}`
    await tx`UPDATE users SET email_verified_at = now() WHERE id = ${stored!.user_id}`
  })

  return { status: 'verified' }
})
