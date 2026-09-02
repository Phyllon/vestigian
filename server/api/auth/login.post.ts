import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { emailTokens, users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

export const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
})

/** One fresh link per quarter of an hour, however often signing in is retried. */
const CONFIRMATION_RESEND_INTERVAL = 15 * 60 * 1000

/**
 * Sends a new confirmation link to an account that has never confirmed one.
 *
 * Without this the flow dead-ends: the first mail is worth nothing after a day,
 * login refuses an unverified address, and there is no other way to ask for
 * another link — a lost or expired mail meant an account nobody could ever
 * reach. It runs only after the password has already been verified, so it adds
 * no way to discover which addresses are registered, and it is the reason this
 * branch has to sit below the credential check rather than beside it.
 *
 * `email_tokens` records no issue time, so the throttle reads it off the
 * expiry, which is the issue time plus a fixed lifetime. That avoids a
 * migration for a column with one use.
 */
interface UnverifiedAccount {
  userId: number
  displayName: string
  email: string
}

const resendConfirmationLink = async (account: UnverifiedAccount): Promise<boolean> => {
  const database = useDatabase()
  const config = useRuntimeConfig()

  const [latest] = await database
    .select({ expiresAt: emailTokens.expiresAt })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, account.userId),
        eq(emailTokens.purpose, 'verify-email'),
        isNull(emailTokens.consumedAt),
      ),
    )
    .orderBy(desc(emailTokens.expiresAt))
    .limit(1)

  const issuedAfter = Date.now() + TOKEN_LIFETIMES['verify-email'] - CONFIRMATION_RESEND_INTERVAL
  if (latest && latest.expiresAt.getTime() > issuedAfter) return false

  const issued = issueToken('verify-email')

  await database.insert(emailTokens).values({
    userId: account.userId,
    tokenHash: issued.tokenHash,
    purpose: 'verify-email',
    expiresAt: issued.expiresAt,
  })

  await sendTokenMail('verify-email', {
    to: account.email,
    displayName: account.displayName,
    link: buildTokenLink(config.public.siteUrl, 'verify-email', issued.token),
    expiresAt: issued.expiresAt,
  })

  return true
}

/**
 * Registers the `sessionCookie` security scheme once, globally. It has to live
 * on some route's `$global`, and this is the route that issues the cookie.
 */
defineRouteMeta({
  openAPI: {
    tags: ['auth'],
    summary: 'Sign in with email and password',
    description:
      'Always hashes, even with no matching account, so timing cannot reveal which emails are registered. Sets the session cookie on success.',
    $global: {
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'vestigian-session',
            description: 'Sealed session cookie set by this endpoint on successful sign-in.',
          },
        },
      },
    },
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'login')
  const credentials = await readValidatedBody(event, credentialsSchema.parse)
  const database = useDatabase()

  /**
   * Matched on `lower(email)`, not on `email`.
   *
   * The only index on the column is `users_email_idx ON users (lower(email))`,
   * so a plain `email = $1` cannot use it — this was a sequential scan of the
   * whole user table on every login attempt, including every failed one, which
   * is precisely the query an attacker gets to repeat. `EXPLAIN` confirms the
   * index scan now.
   */
  const [account] = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      role: users.role,
      approvedContributions: users.approvedContributions,
      trustRevoked: users.trustRevoked,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, credentials.email.toLowerCase()))
    .limit(1)

  // Always hash, even with no match, so timing does not reveal the user table.
  const isValid = await verifyPasswordArgon(
    account?.passwordHash ?? DUMMY_HASH,
    credentials.password,
  )

  if (!account || !isValid) {
    // Deliberately does not record which of the two failed, or the address
    // tried. The endpoint hashes against DUMMY_HASH precisely so that a missing
    // account and a wrong password are indistinguishable; a log line that told
    // them apart would reintroduce the enumeration oracle in the log instead of
    // over HTTP.
    authEventsTotal().inc({ event: 'login', outcome: 'rejected' })
    event.context.log.warn({ audit: 'auth.login' }, 'login rejected')
    throw createError({ statusCode: 401, message: 'That email and password do not match.' })
  }

  if (!account.emailVerifiedAt && !import.meta.dev) {
    const resent = await resendConfirmationLink({
      userId: account.id,
      displayName: account.displayName,
      email: credentials.email,
    })

    authEventsTotal().inc({ event: 'login', outcome: 'unverified' })
    event.context.log.warn(
      { audit: 'auth.login', userId: account.id, resent },
      'login refused: email not verified',
    )
    throw createError({
      statusCode: 403,
      message: resent
        ? 'Confirm your email address first. A fresh link is on its way.'
        : 'Confirm your email address first. A link was sent recently — check your inbox, and the spam folder.',
    })
  }

  authEventsTotal().inc({ event: 'login', outcome: 'accepted' })

  // The session carries the *inputs* to the trust rule, not its result, so the
  // browser can apply `evaluateTrust` itself. Every one of these is a snapshot
  // taken now: the server re-reads role and trust before any decision that
  // matters, and this copy only decides which controls a page offers.
  const user: SessionUser = {
    id: account.id,
    displayName: account.displayName,
    role: account.role,
    trustRevoked: account.trustRevoked,
    approvedContributions: account.approvedContributions,
  }

  event.context.log.info(
    { audit: 'auth.login', userId: account.id, role: account.role },
    'signed in',
  )

  await setUserSession(event, { user, loggedInAt: Date.now() })
  await database.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, account.id))

  return { user }
})
