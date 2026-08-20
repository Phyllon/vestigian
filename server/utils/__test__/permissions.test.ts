import { describe, expect, it } from 'vitest'
import { canReviewContributions, canReviewRevision, hasAtLeastRole } from '../permissions'
import type { SessionUser } from '#shared/types'

const asUser = (id: number, role: SessionUser['role']): SessionUser => ({
  id,
  role,
  displayName: 'Tester',
  trustLevel: 1,
  approvedContributions: 5,
})

describe('hasAtLeastRole', () => {
  it('orders contributor below moderator below admin', () => {
    expect(hasAtLeastRole('contributor', 'moderator')).toBe(false)
    expect(hasAtLeastRole('moderator', 'moderator')).toBe(true)
    expect(hasAtLeastRole('admin', 'moderator')).toBe(true)
  })
})

describe('canReviewContributions', () => {
  it('excludes trusted contributors from the moderation queue', () => {
    expect(canReviewContributions(asUser(1, 'contributor'))).toBe(false)
    expect(canReviewContributions(asUser(1, 'moderator'))).toBe(true)
  })
})

describe('canReviewRevision', () => {
  it('stops a moderator approving their own submission', () => {
    expect(canReviewRevision(asUser(7, 'moderator'), 7)).toBe(false)
    expect(canReviewRevision(asUser(7, 'moderator'), 8)).toBe(true)
  })

  it('applies the same rule to admins', () => {
    expect(canReviewRevision(asUser(7, 'admin'), 7)).toBe(false)
  })

  it('still refuses contributors reviewing other people', () => {
    expect(canReviewRevision(asUser(7, 'contributor'), 8)).toBe(false)
  })
})
