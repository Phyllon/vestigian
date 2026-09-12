import { describe, expect, it } from 'vitest'
import {
  describeRetractionSkip,
  planRetraction,
  summariseRetraction,
  type RetractionInput,
} from '../retraction'

/**
 * The bulk retraction's judgement, asserted rather than inferred from an
 * endpoint's behaviour under a ban nobody wants to test by hand. Each case
 * below is a way the sweep could quietly destroy work that is not the banned
 * account's to destroy.
 */
const input = (overrides: Partial<RetractionInput> = {}): RetractionInput => ({
  createdRecords: [],
  authoredRevisions: [],
  uploadedImages: [],
  ...overrides,
})

describe('planRetraction', () => {
  it('retracts a published record the account created', () => {
    const plan = planRetraction(
      input({ createdRecords: [{ entityType: 'site', entityId: 7, status: 'approved' }] }),
    )

    expect(plan.retractions).toEqual([{ entityType: 'site', entityId: 7 }])
  })

  it('leaves a record that is already offline alone, so running twice is safe', () => {
    const plan = planRetraction(
      input({ createdRecords: [{ entityType: 'site', entityId: 7, status: 'rejected' }] }),
    )

    expect(plan.retractions).toEqual([])
  })

  it('reverts an edit to a record the account did not create', () => {
    const plan = planRetraction(
      input({
        authoredRevisions: [
          { id: 40, entityType: 'site', entityId: 99, status: 'approved', revertsRevisionId: null },
        ],
      }),
    )

    expect(plan.reverts).toEqual([40])
  })

  /**
   * `previousPayload` is the state immediately before a revision, so rolling
   * back out of order restores an intermediate state and then overwrites it
   * with an older one.
   */
  it('orders reverts newest first', () => {
    const plan = planRetraction(
      input({
        authoredRevisions: [10, 40, 25].map((id) => ({
          id,
          entityType: 'site' as const,
          entityId: 99,
          status: 'approved',
          revertsRevisionId: null,
        })),
      }),
    )

    expect(plan.reverts).toEqual([40, 25, 10])
  })

  it('leaves pending work in the moderation queue', () => {
    const plan = planRetraction(
      input({
        authoredRevisions: [
          { id: 40, entityType: 'site', entityId: 99, status: 'pending', revertsRevisionId: null },
        ],
      }),
    )

    expect(plan.reverts).toEqual([])
    expect(plan.untouched).toEqual([{ revisionId: 40, reason: 'pending-review' }])
  })

  it('ignores a revision that was rejected, since it never published', () => {
    const plan = planRetraction(
      input({
        authoredRevisions: [
          { id: 40, entityType: 'site', entityId: 99, status: 'rejected', revertsRevisionId: null },
        ],
      }),
    )

    expect(plan.reverts).toEqual([])
    expect(plan.untouched[0]!.reason).toBe('already-rejected')
  })

  /**
   * The case where undoing this account's activity would make the atlas worse:
   * reverting a revert re-applies exactly what a moderator removed.
   */
  it('never reverts a revert', () => {
    const plan = planRetraction(
      input({
        authoredRevisions: [
          { id: 40, entityType: 'site', entityId: 99, status: 'approved', revertsRevisionId: 12 },
        ],
      }),
    )

    expect(plan.reverts).toEqual([])
    expect(plan.untouched[0]!.reason).toBe('is-a-revert')
  })

  it('does not revert edits to a record it is retracting whole', () => {
    const plan = planRetraction(
      input({
        createdRecords: [{ entityType: 'site', entityId: 7, status: 'approved' }],
        authoredRevisions: [
          { id: 40, entityType: 'site', entityId: 7, status: 'approved', revertsRevisionId: null },
          { id: 41, entityType: 'site', entityId: 99, status: 'approved', revertsRevisionId: null },
        ],
      }),
    )

    expect(plan.reverts).toEqual([41])
    expect(plan.untouched).toEqual([{ revisionId: 40, reason: 'covered-by-retraction' }])
  })

  /** A site and a tracing can share an id; the two must not be confused. */
  it('keys the retraction set by type as well as id', () => {
    const plan = planRetraction(
      input({
        createdRecords: [{ entityType: 'site', entityId: 7, status: 'approved' }],
        authoredRevisions: [
          {
            id: 40,
            entityType: 'tracing',
            entityId: 7,
            status: 'approved',
            revertsRevisionId: null,
          },
        ],
      }),
    )

    expect(plan.reverts).toEqual([40])
  })

  it('skips a revision that was never applied to a record', () => {
    const plan = planRetraction(
      input({
        authoredRevisions: [
          {
            id: 40,
            entityType: 'site',
            entityId: null,
            status: 'approved',
            revertsRevisionId: null,
          },
        ],
      }),
    )

    expect(plan.reverts).toEqual([])
    expect(plan.untouched[0]!.reason).toBe('never-applied')
  })

  it('withdraws every photograph that is not already withdrawn', () => {
    const plan = planRetraction(
      input({
        uploadedImages: [
          { id: 1, status: 'approved' },
          { id: 2, status: 'pending' },
          { id: 3, status: 'rejected' },
        ],
      }),
    )

    expect(plan.imageWithdrawals).toEqual([1, 2])
  })

  it('does not mutate its input', () => {
    const revisions = [
      {
        id: 10,
        entityType: 'site' as const,
        entityId: 99,
        status: 'approved',
        revertsRevisionId: null,
      },
      {
        id: 40,
        entityType: 'site' as const,
        entityId: 99,
        status: 'approved',
        revertsRevisionId: null,
      },
    ]
    const original = [...revisions]

    planRetraction(input({ authoredRevisions: revisions }))

    expect(revisions).toEqual(original)
  })

  it('has an explanation for every skip reason', () => {
    const reasons = [
      'pending-review',
      'already-rejected',
      'never-applied',
      'is-a-revert',
      'covered-by-retraction',
    ] as const

    for (const reason of reasons) {
      expect(describeRetractionSkip(reason)).toMatch(/\S/)
    }
  })
})

describe('summariseRetraction', () => {
  /**
   * The confirmation in the panel counts these, and the sweep then acts on
   * exactly the items they came from — which is the point of planning before
   * applying rather than counting separately.
   */
  it('counts the three kinds of action the plan will take', () => {
    const plan = planRetraction(
      input({
        createdRecords: [
          { entityType: 'site', entityId: 7, status: 'approved' },
          { entityType: 'tracing', entityId: 8, status: 'approved' },
        ],
        authoredRevisions: [
          { id: 40, entityType: 'site', entityId: 99, status: 'approved', revertsRevisionId: null },
        ],
        uploadedImages: [{ id: 1, status: 'approved' }],
      }),
    )

    expect(summariseRetraction(plan)).toEqual({ records: 2, edits: 1, photographs: 1 })
  })
})
