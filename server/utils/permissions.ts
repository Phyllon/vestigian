import type { H3Event } from 'h3'
import type { SessionUser, UserRole } from '#shared/types'

const ROLE_RANK: Record<UserRole, number> = {
  contributor: 0,
  moderator: 1,
  admin: 2,
}

export const hasAtLeastRole = (role: UserRole, required: UserRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[required]

export const canReviewContributions = (user: SessionUser): boolean =>
  hasAtLeastRole(user.role, 'moderator')

/** A moderator may not approve their own submission. */
export const canReviewRevision = (user: SessionUser, authorId: number | null): boolean =>
  canReviewContributions(user) && user.id !== authorId

export const requireModerator = async (event: H3Event): Promise<SessionUser> => {
  const session = await requireUserSession(event)
  const user = session.user as SessionUser
  if (!canReviewContributions(user)) {
    throw createError({ statusCode: 403, message: 'Moderator access required.' })
  }
  return user
}
