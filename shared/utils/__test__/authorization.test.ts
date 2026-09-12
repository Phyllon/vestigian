import { describe, expect, it } from 'vitest'
import {
  TRUST_THRESHOLD,
  canManageImage,
  canReviewContributions,
  canReviewRevision,
  canRevokeTrust,
  checkBan,
  checkRoleChange,
  countsTowardsTrust,
  describeBanRejection,
  describeRoleChangeRejection,
  isAccountActive,
  isSessionCurrent,
  evaluateTrust,
  hasAtLeastRole,
} from '../authorization'
import type { SessionUser, UserRole } from '#shared/types'

const user = (id: number, role: UserRole, overrides: Partial<SessionUser> = {}): SessionUser => ({
  id,
  role,
  displayName: 'Tester',
  trustRevoked: false,
  approvedContributions: 3,
  ...overrides,
})

describe('hasAtLeastRole', () => {
  it('orders the three roles', () => {
    expect(hasAtLeastRole('admin', 'moderator')).toBe(true)
    expect(hasAtLeastRole('moderator', 'moderator')).toBe(true)
    expect(hasAtLeastRole('contributor', 'moderator')).toBe(false)
  })

  it('does not let a moderator reach admin', () => {
    expect(hasAtLeastRole('moderator', 'admin')).toBe(false)
    expect(hasAtLeastRole('admin', 'admin')).toBe(true)
  })
})

describe('canReviewContributions', () => {
  it('excludes contributors and includes both moderator ranks', () => {
    expect(canReviewContributions(user(1, 'contributor'))).toBe(false)
    expect(canReviewContributions(user(1, 'moderator'))).toBe(true)
    expect(canReviewContributions(user(1, 'admin'))).toBe(true)
  })
})

describe('canReviewRevision', () => {
  it('stops a moderator approving their own contribution', () => {
    expect(canReviewRevision(user(7, 'moderator'), 7)).toBe(false)
    expect(canReviewRevision(user(7, 'moderator'), 8)).toBe(true)
  })

  it('applies to admins too', () => {
    expect(canReviewRevision(user(7, 'admin'), 7)).toBe(false)
    expect(canReviewRevision(user(7, 'admin'), 8)).toBe(true)
  })

  it('refuses a contributor regardless of authorship', () => {
    expect(canReviewRevision(user(7, 'contributor'), 8)).toBe(false)
  })

  it('allows review of a revision whose author account was deleted', () => {
    expect(canReviewRevision(user(7, 'moderator'), null)).toBe(true)
  })
})

describe('canManageImage', () => {
  it('lets the uploader withdraw their own photograph', () => {
    expect(canManageImage(user(5, 'contributor'), 5)).toBe(true)
  })

  it('stops a contributor touching someone else’s photograph', () => {
    expect(canManageImage(user(5, 'contributor'), 6)).toBe(false)
  })

  it('lets a moderator manage any photograph', () => {
    expect(canManageImage(user(5, 'moderator'), 6)).toBe(true)
  })

  it('handles an image whose uploader account was deleted', () => {
    expect(canManageImage(user(5, 'contributor'), null)).toBe(false)
    expect(canManageImage(user(5, 'admin'), null)).toBe(true)
  })
})

describe('evaluateTrust', () => {
  const contributor = (approvedContributions: number, trustRevoked = false) =>
    evaluateTrust({ approvedContributions, trustRevoked, role: 'contributor' })

  it('queues a new account', () => {
    expect(contributor(0)).toEqual({ level: 0, autoApprove: false, reason: 'probation' })
  })

  it('still queues one short of the threshold', () => {
    expect(contributor(TRUST_THRESHOLD - 1).autoApprove).toBe(false)
  })

  it('publishes at the threshold', () => {
    expect(contributor(TRUST_THRESHOLD)).toEqual({
      level: 1,
      autoApprove: true,
      reason: 'earned',
    })
  })

  it('lets revocation beat any number of accepted contributions', () => {
    expect(contributor(50, true)).toEqual({ level: 0, autoApprove: false, reason: 'revoked' })
  })

  it('exempts moderators, revoked or not', () => {
    expect(
      evaluateTrust({ approvedContributions: 0, trustRevoked: true, role: 'moderator' }).reason,
    ).toBe('moderator')
    expect(
      evaluateTrust({ approvedContributions: 0, trustRevoked: true, role: 'admin' }).autoApprove,
    ).toBe(true)
  })

  /**
   * The session cookie carries the rule's inputs, so the browser calls this
   * with a `SessionUser` and the server with a row from `users`. If those two
   * shapes ever drift apart this is the assertion that fails.
   */
  it('accepts a SessionUser directly', () => {
    expect(evaluateTrust(user(1, 'contributor', { approvedContributions: 0 })).autoApprove).toBe(
      false,
    )
    expect(evaluateTrust(user(1, 'contributor')).autoApprove).toBe(true)
  })
})

describe('countsTowardsTrust', () => {
  it('counts records but not photographs', () => {
    expect(countsTowardsTrust('site')).toBe(true)
    expect(countsTowardsTrust('tracing')).toBe(true)
    expect(countsTowardsTrust('image')).toBe(false)
  })
})

describe('canRevokeTrust', () => {
  it('is a moderator power over contributors only', () => {
    expect(canRevokeTrust(user(1, 'moderator'), 'contributor')).toBe(true)
    expect(canRevokeTrust(user(1, 'admin'), 'contributor')).toBe(true)
    expect(canRevokeTrust(user(1, 'contributor'), 'contributor')).toBe(false)
    expect(canRevokeTrust(user(1, 'moderator'), 'moderator')).toBe(false)
  })
})

describe('checkRoleChange', () => {
  const change = (overrides: Partial<Parameters<typeof checkRoleChange>[0]> = {}) =>
    checkRoleChange({
      actor: user(1, 'admin'),
      targetUserId: 2,
      targetCurrentRole: 'contributor',
      nextRole: 'moderator',
      ...overrides,
    })

  it('lets an admin promote a contributor', () => {
    expect(change()).toEqual({ allowed: true, reason: null })
  })

  it('refuses a moderator', () => {
    expect(change({ actor: user(1, 'moderator') }).reason).toBe('not-admin')
  })

  it('refuses changing your own role', () => {
    expect(change({ targetUserId: 1 }).reason).toBe('self')
  })

  it('allows granting admin, since admin is the top rank', () => {
    expect(change({ nextRole: 'admin' }).allowed).toBe(true)
  })

  it('refuses demoting any admin, even with others remaining', () => {
    expect(change({ targetCurrentRole: 'admin', nextRole: 'contributor' }).reason).toBe(
      'admin-protected',
    )
  })

  it('has a message for every rejection', () => {
    const reasons = ['not-admin', 'self', 'above-own-rank', 'admin-protected'] as const
    for (const reason of reasons) {
      expect(describeRoleChangeRejection(reason)).toMatch(/\S/)
    }
  })
})

describe('checkBan', () => {
  const ban = (overrides: Partial<Parameters<typeof checkBan>[0]> = {}) =>
    checkBan({
      actor: user(1, 'admin'),
      targetUserId: 2,
      targetCurrentRole: 'contributor',
      ...overrides,
    })

  it('lets an admin block a contributor', () => {
    expect(ban()).toEqual({ allowed: true, reason: null })
  })

  it('lets an admin block a moderator', () => {
    expect(ban({ targetCurrentRole: 'moderator' }).allowed).toBe(true)
  })

  it('refuses a moderator', () => {
    expect(ban({ actor: user(1, 'moderator') }).reason).toBe('not-admin')
  })

  it('refuses blocking your own account', () => {
    expect(ban({ targetUserId: 1 }).reason).toBe('self')
  })

  /**
   * The rule this whole function exists for. `checkRoleChange` refuses to
   * demote an admin unconditionally; a ban that did not refuse the same target
   * would be the back door that rule was made unconditional to close, since a
   * locked-out admin is neutralised as completely as a demoted one.
   */
  it('refuses blocking another admin, unconditionally', () => {
    expect(ban({ targetCurrentRole: 'admin' }).reason).toBe('admin-protected')
  })

  it('has a message for every rejection', () => {
    for (const reason of ['not-admin', 'self', 'admin-protected'] as const) {
      expect(describeBanRejection(reason)).toMatch(/\S/)
    }
  })
})

describe('isAccountActive', () => {
  it('treats a null ban timestamp as good standing', () => {
    expect(isAccountActive({ bannedAt: null })).toBe(true)
  })

  it('treats any ban timestamp as blocked', () => {
    expect(isAccountActive({ bannedAt: new Date('2026-01-01T00:00:00Z') })).toBe(false)
  })
})

describe('isSessionCurrent', () => {
  const epoch = new Date('2026-01-01T12:00:00Z')

  it('accepts a session sealed after the epoch', () => {
    expect(isSessionCurrent({ loggedInAt: epoch.getTime() + 1, sessionsValidFrom: epoch })).toBe(
      true,
    )
  })

  it('refuses a session sealed before the epoch', () => {
    expect(isSessionCurrent({ loggedInAt: epoch.getTime() - 1, sessionsValidFrom: epoch })).toBe(
      false,
    )
  })

  /**
   * The boundary is inclusive on purpose: the epoch is bumped by the same
   * clock that stamps `loggedInAt`, so a session created in the same
   * millisecond as its own epoch is the new one, not an old one to kill.
   */
  it('accepts a session sealed in the same millisecond as the epoch', () => {
    expect(isSessionCurrent({ loggedInAt: epoch.getTime(), sessionsValidFrom: epoch })).toBe(true)
  })

  /** A session predating the column's default is refused rather than trusted. */
  it('refuses a session with no sealed timestamp at all', () => {
    expect(isSessionCurrent({ loggedInAt: 0, sessionsValidFrom: epoch })).toBe(false)
  })
})
