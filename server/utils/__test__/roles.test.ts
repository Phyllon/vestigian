import { describe, expect, it } from 'vitest'
import { canRevokeTrust, checkRoleChange } from '../roles'
import type { SessionUser, UserRole } from '#shared/types'

const actor = (id: number, role: UserRole): SessionUser => ({
  id,
  role,
  displayName: 'Actor',
  trustLevel: 1,
  approvedContributions: 10,
})

const request = (overrides: Partial<Parameters<typeof checkRoleChange>[0]> = {}) => ({
  actor: actor(1, 'admin'),
  targetUserId: 2,
  targetCurrentRole: 'contributor' as UserRole,
  nextRole: 'moderator' as UserRole,
  adminCount: 2,
  ...overrides,
})

describe('checkRoleChange', () => {
  it('lets an admin promote a contributor to moderator', () => {
    expect(checkRoleChange(request())).toEqual({ allowed: true, reason: null })
  })

  it('refuses a moderator trying to change any role', () => {
    expect(checkRoleChange(request({ actor: actor(1, 'moderator') })).reason).toBe('not-admin')
  })

  it('refuses anyone changing their own role', () => {
    expect(checkRoleChange(request({ targetUserId: 1 })).reason).toBe('self')
  })

  it('refuses granting a role above the actor’s own', () => {
    const check = checkRoleChange(
      request({ actor: actor(1, 'admin'), nextRole: 'admin' as UserRole }),
    )
    expect(check.allowed).toBe(true)
  })

  it('protects the last administrator from demotion', () => {
    const check = checkRoleChange(
      request({ targetCurrentRole: 'admin', nextRole: 'contributor', adminCount: 1 }),
    )
    expect(check.reason).toBe('last-admin')
  })

  it('allows demoting an admin when another one remains', () => {
    const check = checkRoleChange(
      request({ targetCurrentRole: 'admin', nextRole: 'contributor', adminCount: 2 }),
    )
    expect(check.allowed).toBe(true)
  })
})

describe('canRevokeTrust', () => {
  it('is a moderator power, not an admin-only one', () => {
    expect(canRevokeTrust(actor(1, 'moderator'), 'contributor')).toBe(true)
    expect(canRevokeTrust(actor(1, 'admin'), 'contributor')).toBe(true)
  })

  it('is not available to contributors', () => {
    expect(canRevokeTrust(actor(1, 'contributor'), 'contributor')).toBe(false)
  })

  it('does not apply to moderators, whose edits bypass the queue by role', () => {
    expect(canRevokeTrust(actor(1, 'admin'), 'moderator')).toBe(false)
  })
})
