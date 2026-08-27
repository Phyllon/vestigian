export type UserRole = 'contributor' | 'moderator' | 'admin'

/**
 * Trust level 0 routes every contribution through the moderation queue.
 * Level 1 is granted automatically once a contributor has two accepted
 * contributions, and may be revoked by a moderator at any time.
 */
export type TrustLevel = 0 | 1

/**
 * What the sealed session cookie carries.
 *
 * Deliberately the *inputs* to the trust rule rather than its result: the
 * client computes `evaluateTrust` itself, so the rule is stated once. Note that
 * every field here is frozen at login — the server re-reads role and trust from
 * the database before any decision that matters, and this copy only decides
 * which controls a page offers.
 */
export interface SessionUser {
  id: number
  displayName: string
  role: UserRole
  trustRevoked: boolean
  approvedContributions: number
}

export interface TrustEvaluation {
  level: TrustLevel
  autoApprove: boolean
  reason: 'revoked' | 'moderator' | 'earned' | 'probation'
}
