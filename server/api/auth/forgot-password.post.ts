import { z } from 'zod'

const bodySchema = z.object({ email: z.string().email().max(320) })

/**
 * Always answers the same way, whether or not the address has an account.
 * Anything else turns this endpoint into a way to test which addresses are
 * registered here.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'register')
  const { email } = await readValidatedBody(event, bodySchema.parse)
  const sql = useSql()
  const config = useRuntimeConfig()

  const [account] = await sql<{ id: number; display_name: string }[]>`
    SELECT id, display_name FROM users WHERE email = ${email.toLowerCase()} LIMIT 1
  `

  if (account) {
    const issued = issueToken('reset-password')

    await sql`
      INSERT INTO email_tokens (user_id, token_hash, purpose, expires_at)
      VALUES (${account.id}, ${issued.tokenHash}, 'reset-password', ${issued.expiresAt})
    `

    await sendTokenMail('reset-password', {
      to: email,
      displayName: account.display_name,
      link: buildTokenLink(config.public.siteUrl, 'reset-password', issued.token),
    })
  }

  return { status: 'sent' }
})
