import type { AdminAction, AdminSubjectType } from '../utils/authorization'
import type { UserRole } from './user'

/**
 * What `/admin`'s endpoints return, declared once for both sides.
 *
 * The panel is eight components over ten endpoints, and every one of those
 * rows was otherwise going to be re-declared as a local `interface` inside a
 * `<script setup>` — which is how `ContributorRow` in the old contributor
 * table came to be a hand-kept copy of a projection nothing checked it
 * against. These are not derived from the handlers automatically (Nitro's own
 * inference does not survive `useFetch` with a generic), so they are still a
 * statement of intent rather than a proof; stating it in one file at least
 * means one place to correct.
 */

/**
 * Structurally identical to `FieldChange` in `server/utils/diff.ts`, and
 * declared again rather than imported: `shared/` is imported by the browser
 * bundle, and reaching into `server/` from here would pull a `postgres`
 * type — and with it the expectation that the module resolves client-side —
 * into every page that renders a diff.
 */
export interface AdminFieldChange {
  field: string
  kind: 'added' | 'removed' | 'changed'
  before: string | null
  after: string | null
}

export interface AdminRevisionEntry {
  id: number
  entityType: string
  entityId: number | null
  title: string | null
  editSummary: string | null
  status: 'pending' | 'approved' | 'rejected'
  /** Published on the trust rule alone, with no human decision behind it. */
  autoApproved: boolean
  isRevert: boolean
  isRetraction: boolean
  changes: AdminFieldChange[]
  substantial: boolean
  blanking: boolean
  createdAt: string
  reviewedAt?: string | null
  reviewNote?: string | null
  authorId: number | null
  authorName: string | null
  authorRole?: UserRole | null
  authorBanned?: boolean
}

export interface AdminActivityResponse {
  items: AdminRevisionEntry[]
  nextCursor: number | null
}

export interface AdminAccountRow {
  id: number
  displayName: string
  email: string
  role: UserRole
  approvedContributions: number
  trustRevoked: boolean
  bannedAt: string | null
  banReason: string | null
  bannedBy: number | null
  emailVerifiedAt: string | null
  twoFactorEnabled: boolean
  publicProfile: boolean
  createdAt: string
  lastSeenAt: string | null
  pendingCount: number
}

export interface AdminAccountsResponse {
  accounts: AdminAccountRow[]
}

export interface AdminDossierRecord {
  id: number
  title: string
  slug?: string
  category?: string
  kind?: string
  status: string
  createdAt: string
}

export interface AdminDossierImage {
  id: number
  siteId: number
  licence: string
  status: string
  createdAt: string
}

export interface AdminAuditEntryRow {
  id: number
  action: AdminAction
  subjectType?: AdminSubjectType
  subjectId?: number | null
  detail: Record<string, unknown> | null
  createdAt: string
  actorId?: number | null
  actorName: string | null
}

export interface AdminDossierResponse {
  account: AdminAccountRow & {
    notifyByEmail: boolean
    preferredLocale: string | null
    bio: string | null
    sessionsValidFrom: string
  }
  counts: {
    revisions: { pending: number; approved: number; rejected: number }
    sitesCreated: number
    tracingsCreated: number
    imagesUploaded: number
    endorsements: number
    visits: number
    bookmarks: number
  }
  createdSites: AdminDossierRecord[]
  createdTracings: AdminDossierRecord[]
  images: AdminDossierImage[]
  listsTruncated: { sites: boolean; tracings: boolean; images: boolean }
  history: AdminRevisionEntry[]
  historyCursor: number | null
  auditTrail: AdminAuditEntryRow[]
}

export interface AdminAuditResponse {
  entries: AdminAuditEntryRow[]
  nextCursor: number | null
}

export interface AdminImageRow {
  id: number
  siteId: number
  siteTitle: string
  siteSlug: string
  caption: string | null
  licence: string
  attribution: string | null
  sourceUrl: string | null
  status: string
  width: number
  height: number
  createdAt: string
  uploaderId: number | null
  uploaderName: string | null
  /** `UNKNOWN` or `ARR` — this one can never be published. */
  licenceUnresolved: boolean
}

export interface AdminImagesResponse {
  images: AdminImageRow[]
}

export interface AdminAttentionCounts {
  pendingRevisions: number
  pendingImages: number
  unresolvedLicences: number
  blockedAccounts: number
  revokedTrust: number
  accountsLastDay: number
  unverifiedAccounts: number
  publishedSites: number
  publishedTracings: number
  accounts: number
}

export interface AdminSystemResponse {
  status: 'ready' | 'degraded'
  checks: { database: boolean; cache: boolean }
  dataVersion: number | null
  uptimeSeconds: number
  attention: AdminAttentionCounts
  counters: {
    name: string
    help: string
    series?: { labels: Record<string, unknown>; value: number }[]
  }[]
}

export interface AdminRetractionSummary {
  records: number
  edits: number
  photographs: number
}

export interface AdminRetractionResponse {
  userId: number
  applied: boolean
  summary: AdminRetractionSummary
  failed?: number
  outcomes?: { kind: 'record' | 'edit' | 'photograph'; id: number; status: string }[]
  untouched: { revisionId: number; reason: string; explanation: string }[]
}

/** The sections of the station, and the order they appear in. */
export const ADMIN_SECTIONS = ['activity', 'accounts', 'images', 'audit', 'system'] as const

export type AdminSection = (typeof ADMIN_SECTIONS)[number]
