import type { ContributionKind, SessionUser, TrustEvaluation, UserRole } from '#shared/types'

/**
 * Every authorization rule in the project, stated once for both sides of the
 * wire — the same arrangement `password.ts` uses, and for the same reason.
 *
 * These rules were previously spread across three server utils, a gallery
 * ordering helper, a composable, a Vue component and two hand-written SQL
 * expressions. "Is at least a moderator" had four spellings and the trust
 * threshold appeared as the literal `2` in five places, twice transcribed into
 * Postgres. Nothing had drifted yet; everything was positioned to.
 *
 * Deliberately pure and free of `H3Event`, so the browser can import it to
 * decide what to *show* while the server imports it to decide what to *allow*.
 * The guards that throw live in `server/utils/permissions.ts`.
 *
 * A policy engine (Casbin, CASL, Cerbos) was evaluated to replace this and
 * rejected: with three roles fixed in a `pgEnum` and every rule living in git,
 * all three buy runtime flexibility the project does not want, and the rules
 * that actually cause trouble here — trust thresholds, the last-admin count,
 * blanking edits — are not the subject/action/resource shape those engines
 * model.
 */

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

/**
 * Who may unpublish or re-order a photograph.
 *
 * The uploader keeps control of their own image, which matters because someone
 * who uploads a photograph they did not have the right to share must be able to
 * withdraw it without waiting on a moderator.
 */
export const canManageImage = (user: SessionUser, uploaderId: number | null): boolean =>
  canReviewContributions(user) || user.id === uploaderId

/**
 * Trust revocation is a moderator power, not an admin one — it is routine
 * housekeeping rather than governance. Moderators and admins are exempt,
 * since their edits bypass the queue by role anyway.
 */
export const canRevokeTrust = (actor: SessionUser, targetRole: UserRole): boolean =>
  canReviewContributions(actor) && targetRole === 'contributor'

/** Accepted contributions required before edits stop being queued. */
export const TRUST_THRESHOLD = 2

/**
 * The inputs to the trust rule, and nothing else.
 *
 * Structurally satisfied by `SessionUser` and by a row selected straight from
 * `users`, so neither caller has to assemble a shape by hand — which is how the
 * three copies of this rule ended up disagreeing about field names.
 */
export interface TrustInput {
  approvedContributions: number
  trustRevoked: boolean
  role: UserRole
}

/**
 * Decides whether a contribution goes live immediately or enters the queue.
 * Kept pure so the rule can be asserted in tests rather than inferred from the
 * behaviour of an endpoint.
 */
export const evaluateTrust = (user: TrustInput): TrustEvaluation => {
  if (hasAtLeastRole(user.role, 'moderator')) {
    return { level: 1, autoApprove: true, reason: 'moderator' }
  }
  if (user.trustRevoked) {
    return { level: 0, autoApprove: false, reason: 'revoked' }
  }
  if (user.approvedContributions >= TRUST_THRESHOLD) {
    return { level: 1, autoApprove: true, reason: 'earned' }
  }
  return { level: 0, autoApprove: false, reason: 'probation' }
}

/**
 * Contributions that count towards the threshold. Images are excluded on
 * purpose: uploading two photographs is a much weaker signal of good faith
 * than writing two site records that survived review.
 */
export const countsTowardsTrust = (kind: ContributionKind): boolean =>
  kind === 'site' || kind === 'tracing'

export type RoleChangeRejection = 'not-admin' | 'self' | 'above-own-rank' | 'admin-protected'

export interface RoleChangeCheck {
  allowed: boolean
  reason: RoleChangeRejection | null
}

export interface RoleChangeRequest {
  actor: SessionUser
  targetUserId: number
  targetCurrentRole: UserRole
  nextRole: UserRole
}

/**
 * Who may change whose role.
 *
 * Three rules, each closing a way an instance can be locked or captured: only
 * admins may change roles at all; nobody may change their own, so a moderator
 * cannot self-promote and an admin cannot be demoted by pressure on their own
 * account; and **no admin can ever demote another admin through this
 * endpoint, full stop** — not "while more than one admin exists," an
 * unconditional block. Granting someone admin used to also hand them the
 * power to strip it back off you; an admin granted in good faith is not
 * assumed to stay one, and this closes that gap. Removing a rogue or
 * compromised co-admin is deliberately left to the same database surgery
 * that creates the first admin (see the security-and-governance notes) —
 * a slower path, chosen on purpose over a button any admin could press
 * against any other.
 *
 * Only the first two rules can actually fire for a demotion *between two
 * different accounts* now that the third is unconditional — an admin can
 * still promote anyone up to admin, just never take admin away from one.
 */
export const checkRoleChange = (request: RoleChangeRequest): RoleChangeCheck => {
  const { actor, targetUserId, targetCurrentRole, nextRole } = request

  if (!hasAtLeastRole(actor.role, 'admin')) return { allowed: false, reason: 'not-admin' }
  if (actor.id === targetUserId) return { allowed: false, reason: 'self' }

  // Unreachable while `admin` is the top rank — the rule above has already
  // forced it. Kept because it is the rule that would have to hold if a fourth
  // role were ever added above admin, and it costs one comparison to keep.
  if (ROLE_RANK[nextRole] > ROLE_RANK[actor.role]) {
    return { allowed: false, reason: 'above-own-rank' }
  }

  if (targetCurrentRole === 'admin' && nextRole !== 'admin') {
    return { allowed: false, reason: 'admin-protected' }
  }

  return { allowed: true, reason: null }
}

export const describeRoleChangeRejection = (reason: RoleChangeRejection): string => {
  const messages: Record<RoleChangeRejection, string> = {
    'not-admin': 'Only an administrator can change roles.',
    self: 'You cannot change your own role.',
    'above-own-rank': 'You cannot grant a role above your own.',
    'admin-protected': 'An administrator cannot be demoted here — this requires database access.',
  }
  return messages[reason]
}
