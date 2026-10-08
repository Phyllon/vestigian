import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `login.post.ts` is a Nitro handler: everything it calls (`enforceRateLimit`,
 * `useDatabase`, `createError`, …) is an auto-import that exists only inside a
 * running server. Each one is replaced here by a stand-in, which is enough for
 * what this file is for — the *order* things happen in and the *shape* of what
 * a refusal reveals. Real argon2, Postgres and Valkey are not involved, so
 * nothing here says the password check itself works; `argon.ts` and the e2e
 * suite do.
 */

const DUMMY_HASH = 'dummy-hash-for-timing'
// Random per run: nothing here is a real secret and the stand-in never checks it.
const STORED_DIGEST = randomUUID()
const CHALLENGE_TTL_SECONDS = 300

const enforceRateLimit = vi.fn()
const readValidatedBody = vi.fn()
const verifyPasswordArgon = vi.fn()
const setUserSession = vi.fn()
const redisSet = vi.fn()
const updateWhere = vi.fn()
const authEventsInc = vi.fn()

let accountRows: unknown[] = []

const database = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => accountRows }) }) }),
  update: () => ({ set: () => ({ where: updateWhere }) }),
}

const verifiedAccount = {
  id: 7,
  displayName: 'Livia',
  passwordHash: STORED_DIGEST,
  role: 'contributor',
  approvedContributions: 3,
  trustRevoked: false,
  emailVerifiedAt: new Date('2026-01-01'),
  totpEnabledAt: null,
  bannedAt: null,
  banReason: null,
}

const credentials = { email: 'Livia@Example.org', password: randomUUID() }

const makeEvent = () => ({ context: { log: { warn: vi.fn(), info: vi.fn() } } })

type LoginHandler = (event: ReturnType<typeof makeEvent>) => Promise<unknown>
let handler: LoginHandler

/** Runs the handler and hands back what it threw; fails if it did not. */
const refusalOf = async (event = makeEvent()) => {
  try {
    await handler(event)
  } catch (error) {
    return error as Error & { statusCode: number; data?: Record<string, unknown> }
  }
  throw new Error('expected the handler to refuse, but it resolved')
}

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('defineRouteMeta', vi.fn())
  vi.stubGlobal('createError', (input: { message: string }) =>
    Object.assign(new Error(input.message), input),
  )
  vi.stubGlobal('enforceRateLimit', enforceRateLimit)
  vi.stubGlobal('readValidatedBody', readValidatedBody)
  vi.stubGlobal('useDatabase', () => database)
  vi.stubGlobal('verifyPasswordArgon', verifyPasswordArgon)
  vi.stubGlobal('DUMMY_HASH', DUMMY_HASH)
  vi.stubGlobal('authEventsTotal', () => ({ inc: authEventsInc }))
  vi.stubGlobal('setUserSession', setUserSession)
  vi.stubGlobal('useRedis', () => ({ set: redisSet }))
  vi.stubGlobal('loginChallengeKey', (id: string) => `login-challenge:${id}`)
  vi.stubGlobal('LOGIN_CHALLENGE_TTL_SECONDS', CHALLENGE_TTL_SECONDS)

  handler = (await import('../login.post')).default as unknown as LoginHandler
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.clearAllMocks()
  accountRows = []
  enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 600 })
  readValidatedBody.mockResolvedValue(credentials)
  verifyPasswordArgon.mockResolvedValue(false)
})

describe('the rate limit comes first', () => {
  it('refuses before reading the body, looking anyone up or hashing anything', async () => {
    const limited = Object.assign(new Error('Too many attempts'), { statusCode: 429 })
    enforceRateLimit.mockRejectedValue(limited)

    await expect(handler(makeEvent())).rejects.toBe(limited)

    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), 'login')
    expect(readValidatedBody).not.toHaveBeenCalled()
    expect(verifyPasswordArgon).not.toHaveBeenCalled()
  })
})

describe('a refused sign-in', () => {
  it('hashes against the dummy hash when no account matches, so timing gives nothing away', async () => {
    accountRows = []

    const refusal = await refusalOf()

    expect(refusal.statusCode).toBe(401)
    expect(verifyPasswordArgon).toHaveBeenCalledWith(DUMMY_HASH, credentials.password)
  })

  it('answers a missing account and a wrong password identically, attempts-left included', async () => {
    accountRows = []
    const unknownAddress = await refusalOf()

    accountRows = [verifiedAccount]
    const wrongPassword = await refusalOf()

    expect(wrongPassword.statusCode).toBe(unknownAddress.statusCode)
    expect(wrongPassword.message).toBe(unknownAddress.message)
    expect(wrongPassword.data).toEqual(unknownAddress.data)
  })

  it('tells the person how many attempts this connection has left', async () => {
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 2, retryAfterSeconds: 600 })

    const refusal = await refusalOf()

    expect(refusal.data).toEqual({ attemptsRemaining: 2 })
  })

  it('says nothing about attempts when the limiter was not applied (cache down)', async () => {
    // `enforceRateLimit` resolves to undefined when it fails open: "unknown"
    // must not be reported as "plenty left".
    enforceRateLimit.mockResolvedValue(undefined)

    const refusal = await refusalOf()

    expect(refusal.data?.attemptsRemaining).toBeUndefined()
  })

  it('does not record which half failed, or which address was tried', async () => {
    accountRows = [verifiedAccount]
    const event = makeEvent()

    await refusalOf(event)

    expect(event.context.log.warn).toHaveBeenCalledExactlyOnceWith(
      { audit: 'auth.login' },
      'login rejected',
    )
    expect(JSON.stringify(event.context.log.warn.mock.calls)).not.toContain('Livia')
  })

  it('counts the refusal as rejected, never as a distinct reason', async () => {
    accountRows = [verifiedAccount]

    await refusalOf()

    expect(authEventsInc).toHaveBeenCalledExactlyOnceWith({ event: 'login', outcome: 'rejected' })
  })
})

describe('a blocked account', () => {
  const blocked = { ...verifiedAccount, bannedAt: new Date('2026-02-01'), banReason: 'spam' }

  it('is told nothing while the password is wrong — blocking is not an oracle', async () => {
    accountRows = [blocked]
    verifyPasswordArgon.mockResolvedValue(false)

    const refusal = await refusalOf()

    expect(refusal.statusCode).toBe(401)
    expect(refusal.message).not.toMatch(/blocked|spam/i)
  })

  it('is told it is blocked, and why, once the password is right', async () => {
    accountRows = [blocked]
    verifyPasswordArgon.mockResolvedValue(true)

    const refusal = await refusalOf()

    expect(refusal.statusCode).toBe(403)
    expect(refusal.message).toContain('spam')
    expect(setUserSession).not.toHaveBeenCalled()
  })
})

describe('an accepted sign-in', () => {
  it('starts a session carrying the inputs to the trust rule and nothing sensitive', async () => {
    accountRows = [verifiedAccount]
    verifyPasswordArgon.mockResolvedValue(true)

    const result = await handler(makeEvent())

    const expectedUser = {
      id: 7,
      displayName: 'Livia',
      role: 'contributor',
      trustRevoked: false,
      approvedContributions: 3,
    }
    expect(result).toEqual({ user: expectedUser })
    expect(setUserSession).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ user: expectedUser, loggedInAt: expect.any(Number) }),
    )
    expect(JSON.stringify(setUserSession.mock.calls)).not.toContain(STORED_DIGEST)
    expect(updateWhere).toHaveBeenCalledOnce()
  })

  it('hands an account with a second factor a challenge instead of a session', async () => {
    accountRows = [{ ...verifiedAccount, totpEnabledAt: new Date('2026-03-01') }]
    verifyPasswordArgon.mockResolvedValue(true)

    const result = (await handler(makeEvent())) as {
      requiresTwoFactor?: boolean
      challengeId?: string
    }

    expect(result.requiresTwoFactor).toBe(true)
    expect(result.challengeId).toMatch(/^[\w-]{20,}$/)
    expect(setUserSession).not.toHaveBeenCalled()
    expect(redisSet).toHaveBeenCalledExactlyOnceWith(
      `login-challenge:${result.challengeId}`,
      JSON.stringify({ userId: 7, attempts: 0 }),
      'EX',
      CHALLENGE_TTL_SECONDS,
    )
  })
})
