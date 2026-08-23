import { z } from 'zod'
import { passwordSchema } from '#shared/utils/password'

const registrationSchema = z.object({
  email: z.string().email().max(320),
  displayName: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[\p{L}\p{N} ._-]+$/u),
  password: passwordSchema,
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
  const passwordHash = await hashPasswordArgon(body.password)

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
    const violation = error as { code?: string; constraint_name?: string }
    if (violation.code !== '23505') throw error

    /**
     * Both conflicts are reported, and the two are not equally cheap.
     *
     * A display name is public — it is printed under every contribution — so
     * saying one is taken discloses nothing that is not already on the site.
     *
     * An email address is not public, and answering differently for a known
     * address turns this endpoint into a way to test whether someone has an
     * account here. That was previously refused: the handler swallowed the
     * conflict and reported success either way. It is now reported, by
     * decision, because a registration form that silently does nothing is a
     * dead end for the person who has simply forgotten they signed up.
     *
     * What keeps it from being a free oracle is what runs before this point:
     * Turnstile on every attempt, and a limit of four attempts per hour per
     * address (`enforceRateLimit`). Enumeration costs a solved challenge per
     * address and caps out at four an hour. If that trade is ever revisited,
     * the alternative is to answer identically here and put the disclosure in
     * the email instead — "someone tried to register with your address" — so
     * only the mailbox owner learns anything.
     */
    const isDisplayNameConflict = violation.constraint_name === 'users_display_name_idx'

    throw createError({
      statusCode: 409,
      message: isDisplayNameConflict
        ? 'That display name is already taken. Pick another and try again.'
        : 'An account already exists for that email address. Sign in, or reset your password.',
      data: { field: isDisplayNameConflict ? 'displayName' : 'email' },
    })
  }

  return { status: 'pending-verification' }
})
