import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/database/schema'
import { hasAtLeastRole } from '#shared/utils/authorization'
import type { SessionUser, UserRole } from '#shared/types'

/**
 * The guards that throw. Every rule they apply lives in
 * `shared/utils/authorization.ts`; what is here is the part that needs an
 * `H3Event` and a database.
 */

/**
 * The caller's role and trust **as they are now**, not as they were at login.
 *
 * `setUserSession` is called in exactly one place — `auth/login.post.ts` — and
 * nuxt-auth-utils seals the result into a stateless cookie that nothing
 * refreshes. Reading role from that cookie meant a demoted moderator kept
 * moderator access until they happened to log out — and since `maxAge` was
 * unset, h3 sealed the session with `ttl: 0`, which means it never expired at
 * all. Demotion is one of the few levers the governance model has; it has to
 * bite on the next request.
 *
 * This is the same reasoning `contributions/images.post.ts` already applies to
 * trust, and the same cost: one primary-key lookup, on the handful of routes
 * that gate on a role. Tiles, records and the map never reach it.
 */
const readCurrentIdentity = async (event: H3Event): Promise<SessionUser> => {
  const session = await requireUserSession(event)
  const sessionUser = session.user as SessionUser

  const [current] = await useDatabase()
    .select({
      role: users.role,
      trustRevoked: users.trustRevoked,
      approvedContributions: users.approvedContributions,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  // The account was deleted while the cookie stayed valid.
  if (!current) {
    throw createError({ statusCode: 401, message: 'Sign in again to continue.' })
  }

  return { id: sessionUser.id, displayName: sessionUser.displayName, ...current }
}

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
