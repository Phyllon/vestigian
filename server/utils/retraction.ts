import type { ContributionKind } from '#shared/types'

/**
 * Deciding what "take everything this account published offline" actually
 * means, as a pure function.
 *
 * The sweep itself is three loops over three existing write paths
 * (`retractRecord`, `revertRevision`, an image status write), none of which is
 * interesting. What *is* interesting is which of a person's contributions
 * belong in which bucket, and getting that wrong is how a bulk action quietly
 * destroys somebody else's work: reverting an edit to a record the banned
 * account did not create rolls back to a state a third party may have since
 * built on, and reverting a *revert* re-applies the very thing a moderator
 * removed. So the decision is separated from the doing and asserted in
 * `__test__/retraction.test.ts` rather than inferred from an endpoint's
 * behaviour under a ban nobody wants to test by hand.
 */

export interface RetractionRecord {
  entityType: ContributionKind
  entityId: number
  status: string
}

export interface RetractionRevision {
  id: number
  entityType: ContributionKind
  entityId: number | null
  status: string
  revertsRevisionId: number | null
}

export interface RetractionImage {
  id: number
  status: string
}

export interface RetractionInput {
  /** Live records whose `created_by` is this account. */
  createdRecords: RetractionRecord[]
  /** Every revision this account authored. */
  authoredRevisions: RetractionRevision[]
  /** Every photograph this account uploaded. */
  uploadedImages: RetractionImage[]
}

export interface RetractionPlan {
  /** Records the account created, to take off the atlas wholesale. */
  retractions: { entityType: ContributionKind; entityId: number }[]
  /** Their edits to other people's records, to roll back, newest first. */
  reverts: number[]
  /** Photographs to withdraw from the galleries. */
  imageWithdrawals: number[]
  /** Revisions deliberately left alone, and why — reported to the admin. */
  untouched: { revisionId: number; reason: RetractionSkipReason }[]
}

export type RetractionSkipReason =
  'pending-review' | 'already-rejected' | 'never-applied' | 'is-a-revert' | 'covered-by-retraction'

export const describeRetractionSkip = (reason: RetractionSkipReason): string => {
  const messages: Record<RetractionSkipReason, string> = {
    'pending-review': 'Still in the moderation queue — judge it on merit there.',
    'already-rejected': 'Already rejected, so it was never published.',
    'never-applied': 'Never applied to a record.',
    'is-a-revert': 'A revert, which is housekeeping rather than a contribution.',
    'covered-by-retraction': 'Its record is being retracted whole.',
  }
  return messages[reason]
}

const recordKey = (entityType: ContributionKind, entityId: number): string =>
  `${entityType}:${entityId}`

/**
 * Splits one account's body of work into the three things that can be done to
 * it. Never mutates its input, and never reorders `createdRecords`.
 */
export const planRetraction = (input: RetractionInput): RetractionPlan => {
  /**
   * Only records that are actually published. A record already `rejected` —
   * withdrawn by a moderator, or retracted by an earlier sweep — is left
   * alone, so running this twice is not a way to write a second retraction
   * revision for the same record.
   */
  const retractions = input.createdRecords
    .filter((record) => record.status === 'approved')
    .map((record) => ({ entityType: record.entityType, entityId: record.entityId }))

  const retracted = new Set(
    retractions.map((record) => recordKey(record.entityType, record.entityId)),
  )

  const reverts: number[] = []
  const untouched: RetractionPlan['untouched'] = []

  /**
   * Newest first. A revision's `previousPayload` is the state immediately
   * before it, so rolling back out of order would restore an intermediate
   * state and then overwrite it with an older one — the newest revert has to
   * happen while it is still the newest thing there.
   */
  const ordered = [...input.authoredRevisions].sort((left, right) => right.id - left.id)

  for (const revision of ordered) {
    if (revision.status === 'pending') {
      // By decision: a ban blocks the person, not their pending work, which
      // stays in the moderator queue to be judged on merit.
      untouched.push({ revisionId: revision.id, reason: 'pending-review' })
      continue
    }

    if (revision.status !== 'approved') {
      untouched.push({ revisionId: revision.id, reason: 'already-rejected' })
      continue
    }

    if (revision.entityId === null) {
      untouched.push({ revisionId: revision.id, reason: 'never-applied' })
      continue
    }

    /**
     * Reverting a revert would re-apply exactly what a moderator removed —
     * the one case where undoing this account's activity makes the atlas
     * worse rather than better.
     */
    if (revision.revertsRevisionId !== null) {
      untouched.push({ revisionId: revision.id, reason: 'is-a-revert' })
      continue
    }

    // The whole record is going offline, so rolling its individual edits back
    // first would be work with no visible effect and a pile of extra history.
    if (retracted.has(recordKey(revision.entityType, revision.entityId))) {
      untouched.push({ revisionId: revision.id, reason: 'covered-by-retraction' })
      continue
    }

    reverts.push(revision.id)
  }

  const imageWithdrawals = input.uploadedImages
    .filter((image) => image.status !== 'rejected')
    .map((image) => image.id)

  return { retractions, reverts, imageWithdrawals, untouched }
}

/** What the confirmation in the panel counts, before anything is written. */
export const summariseRetraction = (
  plan: RetractionPlan,
): { records: number; edits: number; photographs: number } => ({
  records: plan.retractions.length,
  edits: plan.reverts.length,
  photographs: plan.imageWithdrawals.length,
})
