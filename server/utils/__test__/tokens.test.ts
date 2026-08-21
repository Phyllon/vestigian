import { describe, expect, it } from 'vitest'
import {
  buildTokenLink,
  checkToken,
  hashToken,
  issueToken,
  TOKEN_LIFETIMES,
  tokenHashMatches,
} from '../tokens'

describe('issueToken', () => {
  it('never returns the same token twice', () => {
    const first = issueToken('verify-email')
    const second = issueToken('verify-email')
    expect(first.token).not.toBe(second.token)
  })

  it('stores a hash that is not the token itself', () => {
    const issued = issueToken('verify-email')
    expect(issued.tokenHash).not.toBe(issued.token)
    expect(issued.tokenHash).toBe(hashToken(issued.token))
  })

  it('gives reset links a much shorter life than verification links', () => {
    expect(TOKEN_LIFETIMES['reset-password']).toBeLessThan(TOKEN_LIFETIMES['verify-email'])
  })

  it('sets expiry from the given clock', () => {
    const now = 1_700_000_000_000
    const issued = issueToken('reset-password', now)
    expect(issued.expiresAt.getTime()).toBe(now + TOKEN_LIFETIMES['reset-password'])
  })
})

describe('checkToken', () => {
  const now = 1_700_000_000_000

  it('accepts an unused token inside its window', () => {
    const check = checkToken({ expiresAt: new Date(now + 1000), consumedAt: null }, now)
    expect(check).toEqual({ valid: true, reason: null })
  })

  it('rejects a token at the moment it expires', () => {
    const check = checkToken({ expiresAt: new Date(now), consumedAt: null }, now)
    expect(check).toEqual({ valid: false, reason: 'expired' })
  })

  it('rejects a token that was already redeemed', () => {
    const check = checkToken(
      { expiresAt: new Date(now + 10_000), consumedAt: new Date(now - 500) },
      now,
    )
    expect(check.reason).toBe('already-used')
  })

  it('reports an unknown token distinctly from an expired one', () => {
    expect(checkToken(null, now).reason).toBe('unknown')
  })
})

describe('tokenHashMatches', () => {
  it('matches a hash against itself', () => {
    const hash = hashToken('abc')
    expect(tokenHashMatches(hash, hash)).toBe(true)
  })

  it('rejects a different hash without throwing on length mismatch', () => {
    expect(tokenHashMatches(hashToken('abc'), hashToken('abd'))).toBe(false)
    expect(tokenHashMatches('ab', hashToken('abc'))).toBe(false)
  })
})

describe('buildTokenLink', () => {
  it('routes each purpose to its own page', () => {
    expect(buildTokenLink('https://vestigia.org', 'verify-email', 'x')).toContain('/verify?token=')
    expect(buildTokenLink('https://vestigia.org', 'reset-password', 'x')).toContain(
      '/reset-password?token=',
    )
  })

  it('tolerates a trailing slash on the site url', () => {
    expect(buildTokenLink('https://vestigia.org/', 'verify-email', 'x')).toBe(
      'https://vestigia.org/verify?token=x',
    )
  })

  it('escapes tokens containing url-significant characters', () => {
    expect(buildTokenLink('https://vestigia.org', 'verify-email', 'a+b/c=')).toContain(
      'a%2Bb%2Fc%3D',
    )
  })
})
