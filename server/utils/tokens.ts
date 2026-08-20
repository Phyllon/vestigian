import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type TokenPurpose = 'verify-email' | 'reset-password'

/**
 * Verification links are long-lived because people check email on a different
 * device hours later. Reset links are short, because a stale one sitting in an
 * inbox is a standing key to the account.
 */
export const TOKEN_LIFETIMES: Record<TokenPurpose, number> = {
  'verify-email': 24 * 60 * 60 * 1000,
  'reset-password': 60 * 60 * 1000,
}

export interface IssuedToken {
  /** Sent to the user. Never stored. */
  token: string
  /** Stored in place of the token, so a database leak grants nothing. */
  tokenHash: string
  expiresAt: Date
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export const issueToken = (purpose: TokenPurpose, now = Date.now()): IssuedToken => {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + TOKEN_LIFETIMES[purpose]),
  }
}

export interface StoredToken {
  expiresAt: Date
  consumedAt: Date | null
}

export type TokenRejection = 'expired' | 'already-used' | 'unknown'

export interface TokenCheck {
  valid: boolean
  reason: TokenRejection | null
}

/**
 * A token is only good once and only before it expires. Both conditions are
 * checked here rather than in SQL so the failure reason can be shown to the
 * person without a second query.
 */
export const checkToken = (stored: StoredToken | null, now = Date.now()): TokenCheck => {
  if (!stored) return { valid: false, reason: 'unknown' }
  if (stored.consumedAt !== null) return { valid: false, reason: 'already-used' }
  if (stored.expiresAt.getTime() <= now) return { valid: false, reason: 'expired' }
  return { valid: true, reason: null }
}

/** Constant-time comparison, so a token cannot be recovered byte by byte. */
export const tokenHashMatches = (candidate: string, stored: string): boolean => {
  const a = Buffer.from(candidate, 'hex')
  const b = Buffer.from(stored, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const buildTokenLink = (
  siteUrl: string,
  purpose: TokenPurpose,
  token: string,
): string => {
  const path = purpose === 'verify-email' ? '/verify' : '/reset-password'
  return `${siteUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`
}
