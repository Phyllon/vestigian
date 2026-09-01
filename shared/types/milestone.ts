import type { UserRole } from './user'

/**
 * The named marks a notebook can carry. Stable strings, because they are i18n
 * keys (`milestones.<mark>.*`) as well as values — renaming one silently drops
 * a label in six locale files.
 */
export type MilestoneMark =
  | 'first-accepted'
  | 'trusted'
  | 'hundred-accepted'
  | 'first-visit'
  | 'ten-visits'
  | 'hundred-visits'
  | 'five-countries'
  | 'recorded-and-stood'

export interface Milestone {
  mark: MilestoneMark
  /**
   * When it was earned, where the database can say cheaply — the two "first"
   * marks have a real date behind them. The threshold marks do not: knowing
   * when someone crossed ten visits would mean keeping an event log, and an
   * ornament is not worth a table.
   */
  at: string | null
}

/**
 * Every input `evaluateMilestones` reads.
 *
 * The first three fields are `TrustInput`'s, spelled out rather than extended:
 * that interface lives in `shared/utils/authorization.ts`, and importing it
 * here would make `types → utils → types` a cycle. Structural typing means
 * `evaluateTrust(input)` still accepts this, and the authorization tests are
 * what keep the two in step.
 */
export interface MilestoneInput {
  role: UserRole
  trustRevoked: boolean
  approvedContributions: number
  visitCount: number
  /** Distinct `sites.country_code` among visited sites. */
  countriesVisited: number
  /** Sites this account both recorded and later visited. */
  recordedAndVisitedCount: number
  firstAcceptedAt?: string | null
  firstVisitAt?: string | null
}
