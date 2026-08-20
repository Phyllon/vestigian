import type { SessionUser, UserRole } from '#shared/types'

const ROLE_RANK: Record<UserRole, number> = {
  contributor: 0,
  moderator: 1,
  admin: 2,
}

export type RoleChangeRejection =
  | 'not-admin'
  | 'self'
  | 'above-own-rank'
  | 'last-admin'

export interface RoleChangeCheck {
  allowed: boolean
  reason: RoleChangeRejection | null
}

export interface RoleChangeRequest {
  actor: SessionUser
  targetUserId: number
  targetCurrentRole: UserRole
  nextRole: UserRole
  /** How many admins exist, so the last one cannot be demoted. */
  adminCount: number
}

/**
 * Who may change whose role.
 *
 * Three rules, each closing a way an instance can be locked or captured:
 * only admins may change roles at all; nobody may change their own, so a
 * moderator cannot self-promote; and the last admin cannot be demoted, because
 * an instance with no admin has no way back short of database surgery.
 */
export const checkRoleChange = (request: RoleChangeRequest): RoleChangeCheck => {
  const { actor, targetUserId, targetCurrentRole, nextRole, adminCount } = request

  if (actor.role !== 'admin') return { allowed: false, reason: 'not-admin' }
  if (actor.id === targetUserId) return { allowed: false, reason: 'self' }

  if (ROLE_RANK[nextRole] > ROLE_RANK[actor.role]) {
    return { allowed: false, reason: 'above-own-rank' }
  }

  if (targetCurrentRole === 'admin' && nextRole !== 'admin' && adminCount <= 1) {
    return { allowed: false, reason: 'last-admin' }
  }

  return { allowed: true, reason: null }
}

export const describeRoleChangeRejection = (reason: RoleChangeRejection): string => {
  const messages: Record<RoleChangeRejection, string> = {
    'not-admin': 'Only an administrator can change roles.',
    self: 'You cannot change your own role.',
    'above-own-rank': 'You cannot grant a role above your own.',
    'last-admin': 'This is the only administrator. Promote someone else first.',
  }
  return messages[reason]
}

/**
 * Trust revocation is a moderator power, not an admin one — it is routine
 * housekeeping rather than governance. Moderators and admins are exempt,
 * since their edits bypass the queue by role anyway.
 */
export const canRevokeTrust = (actor: SessionUser, targetRole: UserRole): boolean =>
  ROLE_RANK[actor.role] >= ROLE_RANK.moderator && targetRole === 'contributor'
