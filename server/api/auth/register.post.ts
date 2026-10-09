import { z } from 'zod'
import { emailTokens, users } from '~~/server/database/schema'
import { passwordSchema } from '#shared/utils/password'

export const registrationSchema = z.object({
  email: z.string().email().max(320),
  displayName: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[\p{L}\p{N} ._-]+$/u),
  password: passwordSchema,
  altcha: z.string().optional(),
  /** Honeypot. Real browsers leave it empty; most bots fill every field. */
  website: z.string().max(0).optional(),
})

const DISPOSABLE_EMAIL_MESSAGE =
  'Temporary or disposable email addresses cannot be used to register. Please use a permanent address.'

defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Register a new account',
    description:
      'Requires a solved ALTCHA challenge. Unlike forgot-password, a duplicate email or display name is reported as 409 rather than hidden — see the comment below on that trade-off.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'register')

  /**
   * Parsed by hand rather than via `readValidatedBody(event, registrationSchema.parse)`:
   * h3's default validation handler serializes the whole zod issues array into
   * `.message` and drops `.data` to `{issues, name}` — no `field` key. That's
   * invisible for the plain `.email()` format check, since `RegisterForm.vue`
   * already runs the identical check client-side and never lets a malformed
   * address reach this handler, but the disposable-domain check below
   * (not a `.refine()`: the list loads lazily, so it is async) has no
   * client-side twin, so a real user can genuinely hit it. Reshaping
   * the failure the same way the 409 conflict below already is keeps it
   * landing under the email field instead of a garbled toast.
   */
  const rawBody = await readBody(event)
  const parsedBody = registrationSchema.safeParse(rawBody)

  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0]!

    throw createError({
      statusCode: 400,
      message: issue.message,
      data: { field: String(issue.path[0] ?? '') },
    })
  }

  const body = parsedBody.data

  if (await isDisposableEmailDomain(body.email)) {
    throw createError({
      statusCode: 400,
      message: DISPOSABLE_EMAIL_MESSAGE,
      data: { field: 'email' },
    })
  }

  if (body.website) {
    // Answer as though it succeeded so the bot learns nothing from the response.
    authEventsTotal().inc({ event: 'register', outcome: 'accepted' })
    event.context.log.info({ audit: 'auth.register' }, 'account registered, verification sent')

    return { status: 'pending-verification' }
  }

  await assertHumanVisitor(event, body.altcha)

  const database = useDatabase()
  const config = useRuntimeConfig()
  const passwordHash = await hashPasswordArgon(body.password)

  try {
    const [created] = await database
      .insert(users)
      .values({
        // Stored lowercased so the `lower(email)` unique index and every
        // lookup that matches through it agree on one spelling.
        email: body.email.toLowerCase(),
        displayName: body.displayName,
        passwordHash,
      })
      .returning({ id: users.id })

    const issued = issueToken('verify-email')

    await database.insert(emailTokens).values({
      userId: created!.id,
      tokenHash: issued.tokenHash,
      purpose: 'verify-email',
      expiresAt: issued.expiresAt,
    })

    await sendTokenMail('verify-email', {
      to: body.email,
      displayName: body.displayName,
      link: buildTokenLink(config.public.siteUrl, 'verify-email', issued.token),
      expiresAt: issued.expiresAt,
    })
  } catch (error) {
    // drizzle-orm wraps every driver error in `DrizzleQueryError`, whose own
    // `code`/`constraint_name` are `undefined` — the real ones the `postgres`
    // driver set are on `.cause`. Checking the wrapper directly meant this
    // branch never matched, so every duplicate email or display name surfaced
    // as an unhandled 500 instead of the 409 below — confirmed live by
    // `auth.spec.ts`'s "refuses a display name that is already taken".
    const cause = (error as { cause?: unknown }).cause ?? error
    const violation = cause as { code?: string; constraint_name?: string }
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
     * a solved proof-of-work challenge on every attempt, and a limit of four
     * attempts per hour (`enforceRateLimit`). That limit only became real when
     * `resolveForwardedIdentifier` stopped believing an unverified
     * `cf-connecting-ip` — before that, an attacker could mint a fresh bucket
     * per request and the cap was decorative.
     *
     * The challenge is weaker than the Turnstile check it replaced: it prices
     * enumeration rather than detecting it, and a determined attacker pays. If
     * that trade is ever revisited, the alternative is to answer identically
     * here and put the disclosure in the email instead — "someone tried to
     * register with your address" — so only the mailbox owner learns anything.
     */
    const isDisplayNameConflict = violation.constraint_name === 'users_display_name_idx'

    // Which field collided is recorded, the value is not — the address is the
    // thing this endpoint has already decided to disclose over HTTP but has no
    // reason to also accumulate in a log.
    authEventsTotal().inc({
      event: 'register',
      outcome: isDisplayNameConflict ? 'display_name_taken' : 'email_taken',
    })
    event.context.log.warn(
      { audit: 'auth.register', field: isDisplayNameConflict ? 'displayName' : 'email' },
      'registration refused: already exists',
    )

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
