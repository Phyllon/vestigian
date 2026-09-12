import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { hasAtLeastRole, isAccountActive, isSessionCurrent } from '#shared/utils/authorization'
import type { SessionUser, UserRole } from '#shared/types'

/**
 * The guards that throw. Every rule they apply lives in
 * `shared/utils/authorization.ts`; what is here is the part that needs an
 * `H3Event` and a database.
 */

/**
 * The caller's role, trust and standing **as they are now**, not as they were
 * at login.
 *
 * The session is sealed by `auth/login.post.ts` into a stateless cookie that
 * nothing refreshes. (`me/index.patch.ts` re-seals it on a rename, but only to
 * correct `displayName` — it never writes a role, a trust flag or a
 * contribution count, so nothing an authorization decision reads has ever been
 * refreshed there.) Reading role from that cookie meant a demoted moderator kept
 * moderator access until they happened to log out — and since `maxAge` was
 * unset, h3 sealed the session with `ttl: 0`, which means it never expired at
 * all. Demotion is one of the few levers the governance model has; it has to
 * bite on the next request.
 *
 * Two more things are now read for the same reason a role is. A **ban** is
 * worth nothing if it waits for a logout, and the **session epoch**
 * (`users.sessions_valid_from`) is the only revocation a stateless session
 * can have: a cookie sealed before it is spent, which is what actually ends
 * a banned person's live sessions and what "sign out everywhere" does. Both
 * are checked here rather than at each call site, so every route that already
 * asks who the caller is gets them for free.
 *
 * This is the same reasoning `contributions/images.post.ts` already applies to
 * trust, and the same cost: one primary-key lookup, on the routes that gate on
 * an identity. Tiles, records and the map never reach it.
 */
const readCurrentIdentity = async (event: H3Event): Promise<SessionUser> => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser

  const [current] = await useDatabase()
    .select({
      role: users.role,
      trustRevoked: users.trustRevoked,
      approvedContributions: users.approvedContributions,
      bannedAt: users.bannedAt,
      banReason: users.banReason,
      sessionsValidFrom: users.sessionsValidFrom,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  // The account was deleted while the cookie stayed valid.
  if (!current) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  /**
   * 401, deliberately, and the same message the deleted-account branch above
   * uses: a spent cookie is not a refused request, it is an absent one, and
   * every client path in the app already treats 401 as "go and sign in".
   * Answering 403 here would strand someone on a page telling them they are
   * not allowed to do a thing they are in fact allowed to do.
   */
  if (
    !isSessionCurrent({
      loggedInAt: Number(session.loggedInAt ?? 0),
      sessionsValidFrom: current.sessionsValidFrom,
    })
  ) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  if (!isAccountActive(current)) {
    throw createError({
      statusCode: 403,
      message: current.banReason
        ? `This account is blocked: ${current.banReason}`
        : 'This account is blocked. Contact the operators if you believe that is a mistake.',
    })
  }

  return {
    id: sessionUser.id,
    displayName: sessionUser.displayName,
    role: current.role,
    trustRevoked: current.trustRevoked,
    approvedContributions: current.approvedContributions,
  }
}

/**
 * Signed in, not blocked, and holding a session that has not been revoked —
 * with no role requirement at all.
 *
 * This is what every authenticated route should ask for instead of
 * `requireUserSession`, which only proves a cookie unseals. Without it a ban
 * would bite on precisely the routes that gate on a role — the moderation and
 * admin ones a banned contributor could never reach anyway — and on none of
 * the ones that matter: contributing, uploading, endorsing, editing their own
 * account.
 *
 * A Nitro server middleware was considered for this and rejected twice over:
 * it would run on tile and record traffic that carries no session to check,
 * and it would put an authorization decision somewhere other than the guards
 * file, which is the one arrangement the governance model explicitly protects.
 */
export const requireActiveUser = (event: H3Event): Promise<SessionUser> =>
  readCurrentIdentity(event)

const requireRole = async (event: H3Event, required: UserRole): Promise<SessionUser> => {
  const user = await readCurrentIdentity(event)

  if (!hasAtLeastRole(user.role, required)) {
    throw createError({
      statusCode: 403,
      message:
        required === 'admin' ? 'Administrator access required.' : 'Moderator access required.',
    })
  }

  return user
}

export const requireModerator = (event: H3Event): Promise<SessionUser> =>
  requireRole(event, 'moderator')

/**
 * Role changes are governance, so they are gated here rather than resting on
 * `checkRoleChange`'s `not-admin` branch alone — that branch stays as defence
 * in depth, but a caller without the rank should not reach the queries that
 * feed it.
 */
export const requireAdmin = (event: H3Event): Promise<SessionUser> => requireRole(event, 'admin')
