import { z } from 'zod'

const registrationSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().trim().min(3).max(60).regex(/^[\p{L}\p{N} ._-]+$/u),
  password: z.string().min(12).max(200),
  turnstileToken: z.string().optional(),
  /** Honeypot. Real browsers leave it empty; most bots fill every field. */
  website: z.string().max(0).optional(),
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'register')
  const body = await readValidatedBody(event, registrationSchema.parse)

  if (body.website) {
    // Answer as though it succeeded so the bot learns nothing from the response.
    return { status: 'pending-verification' }
  }

  await assertHumanVisitor(event, body.turnstileToken)

  const sql = useSql()
  const config = useRuntimeConfig()
  const passwordHash = await hashPassword(body.password)

  try {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO users (email, display_name, password_hash)
      VALUES (${body.email.toLowerCase()}, ${body.displayName}, ${passwordHash})
      RETURNING id
    `

    const issued = issueToken('verify-email')

    await sql`
      INSERT INTO email_tokens (user_id, token_hash, purpose, expires_at)
      VALUES (${created!.id}, ${issued.tokenHash}, 'verify-email', ${issued.expiresAt})
    `

    await sendTokenMail('verify-email', {
      to: body.email,
      displayName: body.displayName,
      link: buildTokenLink(config.public.siteUrl, 'verify-email', issued.token),
    })
  } catch (error) {
    // Unique violation. The response is identical either way, so registration
    // cannot be used to test whether an address already has an account.
    if ((error as { code?: string }).code !== '23505') throw error
  }

  return { status: 'pending-verification' }
})
