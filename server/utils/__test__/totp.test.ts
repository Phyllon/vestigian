import { Secret, TOTP } from 'otpauth'
import { describe, expect, it } from 'vitest'
import { generateBackupCodes, looksLikeBackupCode, verifyTotpCode } from '../totp'

/**
 * `encryptTotpSecret`/`decryptTotpSecret`/`generatePendingTotpEnrollment` all
 * read `useRuntimeConfig()` or hit the network for a QR render, which is
 * effect rather than logic — see the same note in `altcha.test.ts`. What's
 * worth pinning down here is pure: a code that should verify does, one that
 * shouldn't doesn't, and a backup code is never mistaken for a TOTP code.
 */
describe('verifyTotpCode', () => {
  const secret = new Secret({ size: 20 }).base32

  it('accepts the code the secret actually produces right now', () => {
    const code = new TOTP({ secret, digits: 6, period: 30 }).generate()
    expect(verifyTotpCode(secret, code)).toBe(true)
  })

  it('accepts a code from one step ago, within the validation window', () => {
    const code = new TOTP({ secret, digits: 6, period: 30 }).generate({
      timestamp: Date.now() - 30_000,
    })
    expect(verifyTotpCode(secret, code)).toBe(true)
  })

  it('rejects a code far outside the window', () => {
    const code = new TOTP({ secret, digits: 6, period: 30 }).generate({
      timestamp: Date.now() - 10 * 60_000,
    })
    expect(verifyTotpCode(secret, code)).toBe(false)
  })

  it('rejects a code generated from a different secret', () => {
    const otherSecret = new Secret({ size: 20 }).base32
    const code = new TOTP({ secret: otherSecret, digits: 6, period: 30 }).generate()
    expect(verifyTotpCode(secret, code)).toBe(false)
  })

  it('rejects anything that is not exactly 6 digits, without throwing', () => {
    expect(verifyTotpCode(secret, '12345')).toBe(false)
    expect(verifyTotpCode(secret, '1234567')).toBe(false)
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false)
    expect(verifyTotpCode(secret, '')).toBe(false)
  })

  it('rejects a malformed secret without throwing', () => {
    expect(verifyTotpCode('not-a-valid-base32-secret!!', '123456')).toBe(false)
  })
})

describe('generateBackupCodes', () => {
  it('generates ten codes by default, each shaped XXXX-XXXX', () => {
    const codes = generateBackupCodes()
    expect(codes).toHaveLength(10)
    for (const code of codes) expect(looksLikeBackupCode(code)).toBe(true)
  })

  it('never repeats a code within one batch', () => {
    const codes = generateBackupCodes(50)
    expect(new Set(codes).size).toBe(50)
  })
})

describe('looksLikeBackupCode', () => {
  it('distinguishes a backup code from a TOTP code by shape', () => {
    expect(looksLikeBackupCode('AB12-CD34')).toBe(true)
    expect(looksLikeBackupCode('123456')).toBe(false)
    expect(looksLikeBackupCode('ab12-cd34')).toBe(false) // codes are generated uppercase
    expect(looksLikeBackupCode('AB12CD34')).toBe(false)
  })
})
