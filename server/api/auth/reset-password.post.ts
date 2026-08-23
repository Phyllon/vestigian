import { z } from 'zod'
import { passwordSchema } from '#shared/utils/password'

const bodySchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const { token, password } = await readValidatedBody(event, bodySchema.parse)
  const sql = useSql()

  const [stored] = await sql<
    { id: number; user_id: number; expires_at: Date; consumed_at: Date | null }[]
  >`
    SELECT id, user_id, expires_at, consumed_at
    FROM email_tokens
    WHERE token_hash = ${hashToken(token)} AND purpose = 'reset-password'
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
          ? 'That link has expired. Ask for a new one.'
          : 'That link is no longer valid.',
    })
  }

  const passwordHash = await hashPasswordArgon(password)

  await sql.begin(async (tx) => {
    await tx`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${stored!.user_id}`
    await tx`UPDATE email_tokens SET consumed_at = now() WHERE id = ${stored!.id}`
    // Any other outstanding reset link for this account is now void.
    await tx`
      UPDATE email_tokens SET consumed_at = now()
      WHERE user_id = ${stored!.user_id} AND purpose = 'reset-password' AND consumed_at IS NULL
    `
  })

  // The session is not created here on purpose: resetting a password should end
  // with a deliberate sign-in, not with an automatic one from an emailed link.
  return { status: 'reset' }
})
