export type UserRole = 'contributor' | 'moderator' | 'admin'

/**
 * Trust level 0 routes every contribution through the moderation queue.
 * Level 1 is granted automatically once a contributor has two accepted
 * contributions, and may be revoked by a moderator at any time.
 */
export type TrustLevel = 0 | 1

export interface SessionUser {
  id: number
  displayName: string
  role: UserRole
  trustLevel: TrustLevel
  approvedContributions: number
}

export interface TrustEvaluation {
  level: TrustLevel
  autoApprove: boolean
  reason: 'revoked' | 'moderator' | 'earned' | 'probation'
}
