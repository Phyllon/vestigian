import type { ContributionKind, TrustEvaluation, TrustLevel } from '#shared/types'

/** Accepted contributions required before edits stop being queued. */
export const TRUST_THRESHOLD = 2

interface TrustInput {
  approvedContributions: number
  trustRevoked: boolean
  role: 'contributor' | 'moderator' | 'admin'
}

/**
 * Decides whether a contribution goes live immediately or enters the queue.
 * Kept pure so the rule can be asserted in tests rather than inferred from the
 * behaviour of an endpoint.
 */
export const evaluateTrust = (user: TrustInput): TrustEvaluation => {
  if (user.role === 'moderator' || user.role === 'admin') {
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

export const resolveTrustLevel = (user: TrustInput): TrustLevel =>
  evaluateTrust(user).level

/**
 * Contributions that count towards the threshold. Images are excluded on
 * purpose: uploading two photographs is a much weaker signal of good faith
 * than writing two site records that survived review.
 */
export const countsTowardsTrust = (kind: ContributionKind): boolean =>
  kind === 'site' || kind === 'tracing'
