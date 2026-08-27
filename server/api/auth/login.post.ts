import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import type { SessionUser } from '#shared/types'

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
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
    authEventsTotal().inc({ event: 'login', outcome: 'unverified' })
    event.context.log.warn(
      { audit: 'auth.login', userId: account.id },
      'login refused: email not verified',
    )
    throw createError({ statusCode: 403, message: 'Confirm your email address first.' })
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
