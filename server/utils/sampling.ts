import { randomInt } from 'node:crypto'
import { TRUST_THRESHOLD, hasAtLeastRole } from '#shared/utils/authorization'
import type { UserRole } from '#shared/types'

/**
 * Spot-checking work that has already published.
 *
 * Trust in this project is binary and permanent until revoked: two accepted
 * contributions and everything afterwards publishes immediately, with nothing
 * ever looking again. That is fine for the failure it was designed against —
 * somebody who is obviously bad from the first edit — and blind to the one it
 * was not: a contributor who behaves well enough to earn trust and then
 * degrades records slowly. The revision history makes that detectable; until
 * now nothing looked.
 *
 * **Sampling is post-hoc and must stay that way.** It flags a revision that is
 * already live for a second look. Making it hold a contribution back would
 * quietly undo the trust model — the whole promise of trust is that work
 * publishes immediately — so nothing here writes `status`, and the draw happens
 * after the write rather than before it.
 *
 * The decision is pure and tested; only `sampleAutoApprovedRevision` at the
 * bottom touches a database.
 */

/**
 * The chance a contribution is drawn immediately after its author crosses the
 * threshold. High on purpose: the first edits after trust is granted are both
 * the most informative about whether it was granted correctly and the cheapest
 * to correct.
 */
const INITIAL_SAMPLE_RATE = 0.5

/**
 * The rate the curve decays towards and never goes below.
 *
 * A floor rather than an expiry is the point. A rate that reaches zero makes
 * long-standing accounts permanently unwatched, which is exactly the position a
 * patient bad actor would want; one in twenty keeps every account occasionally
 * visible without making established contributors feel policed.
 */
const SAMPLE_FLOOR = 0.05

export type SampleReason = 'newly-trusted' | 'routine-audit'

export interface SampleDecisionInput {
  /** The author's accepted count *after* this contribution was counted. */
  approvedContributions: number
  /** Reviewed work already had a moderator's eyes; only automatic publishing is sampled. */
  autoApproved: boolean
  authorRole: UserRole
  /**
   * A draw in [0, 1). Injected rather than taken from `Math.random()` here so
   * the rule is tested as a rule — asserting a probability by sampling it would
   * be a slow, flaky test of the random number generator.
   */
  roll: number
}

export type SampleDecision =
  { sample: true; reason: SampleReason; rate: number } | { sample: false; rate: number }

/**
 * How likely a contribution is to be drawn, given how long its author has been
 * trusted.
 *
 * Decays as `INITIAL / (1 + contributions since the threshold)` and clamps at
 * `SAMPLE_FLOOR`: 50% on the first auto-approved contribution, 25% on the next,
 * then 17%, 12.5%, and so on down to a permanent 5%. Weighted towards the
 * beginning because that is when the evidence is thinnest and a mistaken grant
 * of trust is cheapest to catch.
 */
export const sampleRateFor = (approvedContributions: number): number => {
  const sinceThreshold = Math.max(0, approvedContributions - TRUST_THRESHOLD)
  return Math.max(SAMPLE_FLOOR, INITIAL_SAMPLE_RATE / (1 + sinceThreshold))
}

/**
 * Whether this revision is drawn for a second look.
 *
 * Moderators and administrators are excluded. Their work publishes immediately
 * because of their role rather than an earned count, they are already
 * accountable through `admin_audit_log`, and sampling them would fill the queue
 * with the reviewers' own edits — crowding out the contributors the sample
 * exists to watch.
 */
export const planSample = (input: SampleDecisionInput): SampleDecision => {
  const rate = sampleRateFor(input.approvedContributions)

  // A moderator already looked at this one; a second look is not a sample.
  if (!input.autoApproved) return { sample: false, rate }

  if (hasAtLeastRole(input.authorRole, 'moderator')) return { sample: false, rate }

  if (input.roll >= rate) return { sample: false, rate }

  return {
    sample: true,
    // The elevated window, versus the permanent floor every account sits at
    // eventually — a moderator triaging the queue can tell "this account was
    // just trusted" from "this is the routine one-in-twenty".
    reason: rate > SAMPLE_FLOOR ? 'newly-trusted' : 'routine-audit',
    rate,
  }
}

export interface SampleCandidate {
  revisionId: number
  authorId: number
}

/**
 * Cryptographically random, not `Math.random()`, and that distinction is real
 * here rather than cargo-culted.
 *
 * This mechanism is adversarial by design — it exists to catch somebody who
 * earned trust deliberately and is degrading records on purpose. V8's
 * `Math.random()` is a seeded xorshift whose internal state is recoverable from
 * a modest run of outputs, so an attacker able to observe which of their own
 * contributions were drawn could in principle predict the sequence and time the
 * damaging edits into the gaps. `randomInt` draws from the OS entropy pool,
 * where no such inference exists.
 *
 * Scaled from an integer draw rather than dividing a float, so the distribution
 * stays uniform: `randomInt` is itself rejection-sampled and unbiased.
 */
const DRAW_PRECISION = 1_000_000

const drawUniform = (): number => randomInt(0, DRAW_PRECISION) / DRAW_PRECISION

/**
 * Draws for one just-published revision and records the result.
 *
 * Called from `applyRevision` after the transaction commits, so a failure here
 * can never roll back a contribution that was legitimately published — a
 * missing spot-check is a far smaller harm than a lost record, which is the
 * same fail-open reasoning already applied to rate limiting, mail delivery and
 * concordance verification.
 *
 * The author's count is read *after* the transaction that incremented it, so
 * the rate reflects this contribution rather than the one before it.
 */
export const sampleAutoApprovedRevision = async (candidate: SampleCandidate): Promise<void> => {
  const sql = useSql()

  try {
    const [author] = await sql<{ role: UserRole; approved_contributions: number }[]>`
      SELECT role, approved_contributions FROM users WHERE id = ${candidate.authorId} LIMIT 1
    `

    if (!author) return

    const decision = planSample({
      approvedContributions: Number(author.approved_contributions),
      autoApproved: true,
      authorRole: author.role,
      roll: drawUniform(),
    })

    if (!decision.sample) return

    await sql`
      UPDATE revisions
      SET sampled_at = now(), sample_reason = ${decision.reason}
      WHERE id = ${candidate.revisionId}
    `

    useLogger().info(
      {
        audit: 'revision.sampled',
        revisionId: candidate.revisionId,
        authorId: candidate.authorId,
        reason: decision.reason,
        rate: decision.rate,
      },
      'auto-approved revision drawn for review',
    )
  } catch (error) {
    // Never fatal: the contribution is already published and correct.
    useLogger().warn(
      { revisionId: candidate.revisionId, err: { message: (error as Error).message } },
      'could not draw a review sample',
    )
  }
}
