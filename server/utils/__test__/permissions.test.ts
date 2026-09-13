import { describe, expect, it } from 'vitest'
import { decideIdentity, type CurrentAccount } from '../permissions'

/**
 * The order in which a caller's standing is judged.
 *
 * Every *rule* here already lives in `shared/utils/authorization.ts` and is
 * asserted in its own test file. What is asserted here is the sequence, and the
 * status code each step answers with — neither of which is visible from the
 * rules themselves, and both of which decide what a blocked or logged-out
 * person actually sees.
 */

const account = (overrides: Partial<CurrentAccount> = {}): CurrentAccount => ({
  role: 'contributor',
  trustRevoked: false,
  approvedContributions: 4,
  bannedAt: null,
  banReason: null,
  sessionsValidFrom: new Date(1_000),
  ...overrides,
})

const sealed = (loggedInAt = 2_000) => ({ id: 7, displayName: 'Sabina', loggedInAt })

describe('decideIdentity', () => {
  it('admits a signed-in account in good standing', () => {
    const decision = decideIdentity({ sealed: sealed(), current: account() })

    expect(decision).toEqual({
      ok: true,
      user: {
        id: 7,
        displayName: 'Sabina',
        role: 'contributor',
        trustRevoked: false,
        approvedContributions: 4,
      },
    })
  })

  /**
   * The reason this lookup exists at all. The session is sealed at login and
   * nothing refreshes it, so a role read from the cookie would let a demoted
   * moderator keep moderating until they happened to sign out.
   */
  it('reports the role the database holds now, not the one sealed at login', () => {
    const decision = decideIdentity({ sealed: sealed(), current: account({ role: 'moderator' }) })

    expect(decision).toMatchObject({ ok: true, user: { role: 'moderator' } })
  })

  it('answers 401 when the account was deleted under a still-valid cookie', () => {
    expect(decideIdentity({ sealed: sealed(), current: undefined })).toEqual({
      ok: false,
      status: 401,
      message: 'Sign in again to continue.',
    })
  })

  /**
   * A spent cookie is an absent request, not a refused one, and every client
   * path in this app treats 401 as "go and sign in". A 403 here would strand
   * someone on a page telling them they may not do something they are in fact
   * allowed to do.
   */
  it('answers 401, not 403, for a session revoked after it was sealed', () => {
    const decision = decideIdentity({
      sealed: sealed(1_000),
      current: account({ sessionsValidFrom: new Date(5_000) }),
    })

    expect(decision).toMatchObject({ ok: false, status: 401 })
  })

  it('keeps a session sealed in the same millisecond as its own epoch', () => {
    const decision = decideIdentity({
      sealed: sealed(5_000),
      current: account({ sessionsValidFrom: new Date(5_000) }),
    })

    expect(decision).toMatchObject({ ok: true })
  })

  it('answers 403 for a blocked account, and passes the reason on', () => {
    const decision = decideIdentity({
      sealed: sealed(),
      current: account({ bannedAt: new Date(3_000), banReason: 'Repeated fabricated findspots' }),
    })

    expect(decision).toEqual({
      ok: false,
      status: 403,
      message: 'This account is blocked: Repeated fabricated findspots',
    })
  })

  it('still explains itself when a block carries no reason', () => {
    const decision = decideIdentity({
      sealed: sealed(),
      current: account({ bannedAt: new Date(3_000) }),
    })

    expect(decision).toMatchObject({ ok: false, status: 403 })
    expect((decision as { message: string }).message).toContain('blocked')
  })

  /**
   * The ordering that matters most. Blocking an account bumps
   * `sessions_valid_from`, and so does *lifting* the block — so someone whose
   * block was just lifted arrives with a spent cookie and a clean record. They
   * are told to sign in again, which is true and actionable; telling them they
   * are blocked would be neither.
   */
  it('judges a spent session before a block, so a lifted block reads as “sign in again”', () => {
    const decision = decideIdentity({
      sealed: sealed(1_000),
      current: account({
        sessionsValidFrom: new Date(5_000),
        bannedAt: new Date(3_000),
        banReason: 'Stale',
      }),
    })

    expect(decision).toMatchObject({ ok: false, status: 401 })
  })

  /** Trust is carried through untouched — revoking it re-queues edits, it does not refuse the request. */
  it('admits an account whose trust was revoked, carrying the flag through', () => {
    const decision = decideIdentity({ sealed: sealed(), current: account({ trustRevoked: true }) })

    expect(decision).toMatchObject({ ok: true, user: { trustRevoked: true } })
  })
})
