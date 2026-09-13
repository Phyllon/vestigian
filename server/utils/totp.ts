import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { Secret, TOTP, URI } from 'otpauth'
import QRCode from 'qrcode'

/**
 * Opt-in two-factor login. TOTP (RFC 6238) rather than SMS or a hosted push
 * service: it has no provider at all — a shared secret plus the current
 * time, checked entirely on this server and in the visitor's own
 * authenticator app, with no network call to anyone. That is what makes it
 * fit this project's self-hosted posture (fonts, glyphs, translation,
 * ALTCHA) better than any alternative, and it is the reason CLAUDE.md
 * carries no "contact so-and-so before enabling this in production" note
 * for it the way the antiquity basemaps and the Tabula Peutingeriana
 * network do — there is no third party to ask.
 */

const ISSUER = 'Vestigian'
/** RFC 6238 defaults: SHA-1, 6 digits, 30-second steps. Every authenticator app assumes these. */
const ALGORITHM = 'SHA1'
const DIGITS = 6
const PERIOD = 30
/** One step either side of "now", the conventional tolerance for clock drift between server and phone. */
const VALIDATION_WINDOW = 1

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
/**
 * Node defaults to this already, but pinned explicitly on both sides: without
 * it, `setAuthTag` accepts any shorter tag an attacker with write access to
 * the stored ciphertext could supply, which raises the odds of a forged tag
 * being accepted. Explicit here costs nothing and closes that off outright.
 */
const AUTH_TAG_LENGTH = 16

const readEncryptionKey = (): Buffer => {
  const { totpEncryptionKey } = useRuntimeConfig()

  if (!totpEncryptionKey) {
    throw createError({
      statusCode: 503,
      message: 'Two-factor authentication is not configured. Set NUXT_TOTP_ENCRYPTION_KEY.',
    })
  }

  const key = Buffer.from(totpEncryptionKey, 'hex')
  if (key.length !== 32) {
    throw createError({
      statusCode: 503,
      message: 'NUXT_TOTP_ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32).',
    })
  }

  return key
}

/**
 * Unlike `passwordHash` or a token's `hashToken`, the stored secret has to
 * come back out — verifying a live code means recomputing it from the
 * secret, not comparing digests — so this is reversible encryption, not a
 * one-way hash. AES-256-GCM: the auth tag is what turns a tampered
 * ciphertext into a hard decryption failure rather than silently wrong
 * bytes. `iv:authTag:ciphertext`, each hex, joined so the whole thing is one
 * column.
 */
export const encryptTotpSecret = (secretBase32: string): string => {
  const key = readEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':')
}

export const decryptTotpSecret = (encrypted: string): string => {
  const key = readEncryptionKey()
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':')
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw createError({ statusCode: 500, message: 'Stored two-factor secret is malformed.' })
  }

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(ivHex, 'hex'), {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

export interface PendingTotpEnrollment {
  secretBase32: string
  otpauthUri: string
  qrCodeDataUri: string
}

/**
 * A fresh secret and the two ways to load it into an authenticator app — a
 * scannable QR code and the manual-entry key underneath it, for anyone
 * whose camera can't reach the screen. Not persisted here: the caller holds
 * this in Valkey until a confirming code proves the app actually has it
 * (`server/api/auth/2fa/setup.post.ts`).
 */
export const generatePendingTotpEnrollment = async (
  accountEmail: string,
): Promise<PendingTotpEnrollment> => {
  const secret = new Secret({ size: 20 })
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountEmail,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  })

  const otpauthUri = URI.stringify(totp)
  const qrCodeDataUri = await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: 'M' })

  return { secretBase32: secret.base32, otpauthUri, qrCodeDataUri }
}

/**
 * `code` is whatever the visitor typed — 6 digits expected, but never
 * assumed, since a backup code or garbage might land here too. Returns
 * `false` rather than throwing for anything malformed, matching
 * `verifyPasswordArgon`'s shape: a wrong answer, not a crash.
 */
export const verifyTotpCode = (secretBase32: string, code: string): boolean => {
  if (!/^\d{6}$/.test(code)) return false

  try {
    const delta = TOTP.validate({
      token: code,
      secret: Secret.fromBase32(secretBase32),
      algorithm: ALGORITHM,
      digits: DIGITS,
      period: PERIOD,
      window: VALIDATION_WINDOW,
    })
    return delta !== null
  } catch {
    return false
  }
}

/**
 * Ten codes, each rendered as `XXXX-XXXX` from `crypto.randomBytes` —
 * readable off a printout, not confusable letters/digits since the
 * source alphabet is plain hex. Callers hash each with `hashToken` before
 * storing, exactly like `emailTokens`; the plaintext returned here is shown
 * to the account holder exactly once.
 */
export const BACKUP_CODE_COUNT = 10

export const generateBackupCodes = (count = BACKUP_CODE_COUNT): string[] =>
  Array.from({ length: count }, () => {
    const raw = randomBytes(4).toString('hex').toUpperCase()
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
  })

/** A backup code is 9 characters (`XXXX-XXXX`); a TOTP code is 6 digits — enough to tell them apart before touching the database. */
export const looksLikeBackupCode = (code: string): boolean => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(code)

/**
 * Valkey key builders shared by every step of enrollment and login, so the
 * two never drift into typo'd namespaces of each other.
 */
export const PENDING_ENROLLMENT_TTL_SECONDS = 10 * 60
export const pendingEnrollmentKey = (userId: number): string => `2fa:pending:${userId}`

/** 8 wrong codes against one challenge invalidates it outright, tighter than the IP-wide `twoFactorVerify` rate limit that also applies. */
export const LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60
export const MAX_CHALLENGE_ATTEMPTS = 8
export const loginChallengeKey = (challengeId: string): string => `2fa:challenge:${challengeId}`
