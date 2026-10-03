import { Gauge } from '@prometheus-io/client'
import { count, eq, isNotNull, sql } from 'drizzle-orm'
import {
  importRuns,
  revisions,
  siteEndorsements,
  siteImages,
  sites,
  tracings,
  users,
} from '~~/server/database/schema'

/**
 * Aggregate gauges describing the atlas itself — how big it is, how complete,
 * how much is waiting for a moderator, who is on it — computed when Prometheus
 * scrapes rather than pushed on every write.
 *
 * **Counts only.** No row, name, address or id ever leaves the database through
 * this file: every value is `count(*)`, an age or a timestamp, keyed by a
 * bounded vocabulary (status, role, category, licence, import source). That is
 * what keeps it inside the same rule `metrics.ts` states for every label, and
 * what makes it safe to keep as 15 days of history in a store that also holds
 * request logs.
 *
 * One snapshot serves every gauge and is reused for `SNAPSHOT_TTL_MS`, so a
 * dashboard refresh, an alert evaluation and a second Prometheus cannot each
 * cost the database a dozen aggregates. A failed refresh keeps the last good
 * snapshot and says so in the log: a gap in a graph is worse than a number that
 * is thirty seconds old.
 */
const SNAPSHOT_TTL_MS = 30_000

interface LabelledValue {
  labels: Record<string, string>
  value: number
}

interface CatalogueSnapshot {
  sitesByStatus: LabelledValue[]
  sitesByCategory: LabelledValue[]
  sitesMissing: LabelledValue[]
  tracingsByStatus: LabelledValue[]
  imagesByStatus: LabelledValue[]
  publishedImagesByLicence: LabelledValue[]
  imagesOldestPendingSeconds: number
  usersByState: LabelledValue[]
  usersByRole: LabelledValue[]
  revisionsByStatus: LabelledValue[]
  revisionsOldestPendingSeconds: number
  endorsements: number
  importLastRunTimestamp: LabelledValue[]
  importLastRowCount: LabelledValue[]
}

const toValues = (rows: { key: string | null; total: number }[], label: string): LabelledValue[] =>
  rows.map((row) => ({ labels: { [label]: row.key ?? 'none' }, value: Number(row.total) }))

const takeSnapshot = async (): Promise<CatalogueSnapshot> => {
  const database = useDatabase()

  const [
    sitesByStatus,
    sitesByCategory,
    [gaps],
    tracingsByStatus,
    imagesByStatus,
    publishedImagesByLicence,
    [oldestImage],
    [accounts],
    usersByRole,
    revisionsByStatus,
    [oldestRevision],
    [endorsementTotal],
    importRows,
  ] = await Promise.all([
    database
      .select({ key: sql<string>`${sites.status}::text`, total: count() })
      .from(sites)
      .groupBy(sites.status),
    database
      .select({ key: sql<string>`${sites.category}::text`, total: count() })
      .from(sites)
      .where(eq(sites.status, 'approved'))
      .groupBy(sites.category),
    database
      .select({
        // Written out with explicit qualifiers: Drizzle renders `${sites.id}` as a
        // bare "id" in a single-table select, which inside the subquery means
        // `site_images.id` and quietly makes every site look unphotographed.
        photograph: sql<number>`count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM site_images si WHERE si.site_id = "sites"."id" AND si.status = 'approved'
        ))::int`,
        description: sql<number>`count(*) FILTER (WHERE ${sites.description} IS NULL OR ${sites.description} = '')::int`,
        period: sql<number>`count(*) FILTER (WHERE ${sites.periodFrom} IS NULL AND ${sites.periodTo} IS NULL)::int`,
        summary: sql<number>`count(*) FILTER (WHERE ${sites.summary} IS NULL OR ${sites.summary} = '')::int`,
      })
      .from(sites)
      .where(eq(sites.status, 'approved')),
    database
      .select({ key: sql<string>`${tracings.status}::text`, total: count() })
      .from(tracings)
      .groupBy(tracings.status),
    database
      .select({ key: sql<string>`${siteImages.status}::text`, total: count() })
      .from(siteImages)
      .groupBy(siteImages.status),
    database
      .select({ key: siteImages.licence, total: count() })
      .from(siteImages)
      .where(eq(siteImages.status, 'approved'))
      .groupBy(siteImages.licence),
    database
      .select({
        age: sql<number>`COALESCE(EXTRACT(EPOCH FROM now() - min(${siteImages.createdAt})), 0)::float8`,
      })
      .from(siteImages)
      .where(eq(siteImages.status, 'pending')),
    database
      .select({
        total: count(),
        verified: sql<number>`count(*) FILTER (WHERE ${users.emailVerifiedAt} IS NOT NULL)::int`,
        banned: sql<number>`count(*) FILTER (WHERE ${users.bannedAt} IS NOT NULL)::int`,
        trustRevoked: sql<number>`count(*) FILTER (WHERE ${users.trustRevoked})::int`,
        trusted: sql<number>`count(*) FILTER (WHERE ${users.approvedContributions} >= 2 AND NOT ${users.trustRevoked})::int`,
        twoFactor: sql<number>`count(*) FILTER (WHERE ${users.totpEnabledAt} IS NOT NULL)::int`,
        activeDay: sql<number>`count(*) FILTER (WHERE ${users.lastSeenAt} > now() - interval '1 day')::int`,
        activeWeek: sql<number>`count(*) FILTER (WHERE ${users.lastSeenAt} > now() - interval '7 days')::int`,
        activeMonth: sql<number>`count(*) FILTER (WHERE ${users.lastSeenAt} > now() - interval '30 days')::int`,
      })
      .from(users),
    database
      .select({ key: sql<string>`${users.role}::text`, total: count() })
      .from(users)
      .groupBy(users.role),
    database
      .select({ key: sql<string>`${revisions.status}::text`, total: count() })
      .from(revisions)
      .groupBy(revisions.status),
    database
      .select({
        age: sql<number>`COALESCE(EXTRACT(EPOCH FROM now() - min(${revisions.createdAt})), 0)::float8`,
      })
      .from(revisions)
      .where(eq(revisions.status, 'pending')),
    database.select({ total: count() }).from(siteEndorsements),
    database
      .selectDistinctOn([importRuns.source], {
        source: importRuns.source,
        rowCount: importRuns.rowCount,
        ranAt: importRuns.ranAt,
      })
      .from(importRuns)
      .where(isNotNull(importRuns.ranAt))
      .orderBy(importRuns.source, sql`${importRuns.ranAt} DESC`),
  ])

  const account = (state: string, value: number | undefined): LabelledValue => ({
    labels: { state },
    value: Number(value ?? 0),
  })

  return {
    sitesByStatus: toValues(sitesByStatus, 'status'),
    sitesByCategory: toValues(sitesByCategory, 'category'),
    sitesMissing: (['photograph', 'description', 'period', 'summary'] as const).map((gap) => ({
      labels: { gap },
      value: Number(gaps?.[gap] ?? 0),
    })),
    tracingsByStatus: toValues(tracingsByStatus, 'status'),
    imagesByStatus: toValues(imagesByStatus, 'status'),
    publishedImagesByLicence: toValues(publishedImagesByLicence, 'licence'),
    imagesOldestPendingSeconds: Number(oldestImage?.age ?? 0),
    usersByState: [
      account('total', accounts?.total),
      account('verified', accounts?.verified),
      account('banned', accounts?.banned),
      account('trust_revoked', accounts?.trustRevoked),
      account('trusted', accounts?.trusted),
      account('two_factor', accounts?.twoFactor),
      account('active_1d', accounts?.activeDay),
      account('active_7d', accounts?.activeWeek),
      account('active_30d', accounts?.activeMonth),
    ],
    usersByRole: toValues(usersByRole, 'role'),
    revisionsByStatus: toValues(revisionsByStatus, 'status'),
    revisionsOldestPendingSeconds: Number(oldestRevision?.age ?? 0),
    endorsements: Number(endorsementTotal?.total ?? 0),
    importLastRunTimestamp: importRows.map((row) => ({
      labels: { source: row.source },
      value: row.ranAt.getTime() / 1000,
    })),
    importLastRowCount: importRows.map((row) => ({
      labels: { source: row.source },
      value: row.rowCount,
    })),
  }
}

let cached: { takenAt: number; snapshot: CatalogueSnapshot } | undefined
let inFlight: Promise<CatalogueSnapshot | undefined> | undefined

const readSnapshot = async (): Promise<CatalogueSnapshot | undefined> => {
  if (cached && Date.now() - cached.takenAt < SNAPSHOT_TTL_MS) return cached.snapshot

  // One refresh at a time: every gauge's `collect` asks within the same scrape.
  inFlight ??= takeSnapshot()
    .then((snapshot) => {
      cached = { takenAt: Date.now(), snapshot }
      return snapshot
    })
    .catch((error: Error) => {
      useLogger().warn({ err: { message: error.message } }, 'catalogue metrics snapshot failed')
      return cached?.snapshot
    })
    .finally(() => {
      inFlight = undefined
    })

  return inFlight
}

interface SnapshotGaugeOptions {
  name: string
  help: string
  labelNames?: string[]
  read: (snapshot: CatalogueSnapshot) => LabelledValue[]
}

const defineSnapshotGauge = (options: SnapshotGaugeOptions): Gauge =>
  new Gauge({
    name: options.name,
    help: options.help,
    labelNames: options.labelNames ?? [],
    registers: [useMetrics()],
    async collect() {
      const snapshot = await readSnapshot()
      if (!snapshot) return
      this.reset()
      for (const entry of options.read(snapshot)) this.set(entry.labels, entry.value)
    },
  })

const scalar = (value: number): LabelledValue[] => [{ labels: {}, value }]

let registered = false

/** Idempotent; called from the scrape endpoint so the gauges exist before the first scrape reads them. */
export const registerCatalogueMetrics = (): void => {
  if (registered) return
  registered = true

  defineSnapshotGauge({
    name: 'atlas_sites',
    help: 'Sites by review status.',
    labelNames: ['status'],
    read: (snapshot) => snapshot.sitesByStatus,
  })
  defineSnapshotGauge({
    name: 'atlas_sites_by_category',
    help: 'Published sites by category.',
    labelNames: ['category'],
    read: (snapshot) => snapshot.sitesByCategory,
  })
  defineSnapshotGauge({
    name: 'atlas_sites_missing',
    help: 'Published sites still lacking a photograph, description, period or summary.',
    labelNames: ['gap'],
    read: (snapshot) => snapshot.sitesMissing,
  })
  defineSnapshotGauge({
    name: 'atlas_tracings',
    help: 'Tracings by review status.',
    labelNames: ['status'],
    read: (snapshot) => snapshot.tracingsByStatus,
  })
  defineSnapshotGauge({
    name: 'atlas_images',
    help: 'Photographs by review status.',
    labelNames: ['status'],
    read: (snapshot) => snapshot.imagesByStatus,
  })
  defineSnapshotGauge({
    name: 'atlas_images_published_by_licence',
    help: 'Published photographs by licence.',
    labelNames: ['licence'],
    read: (snapshot) => snapshot.publishedImagesByLicence,
  })
  defineSnapshotGauge({
    name: 'atlas_images_oldest_pending_seconds',
    help: 'Age of the oldest photograph waiting for review; 0 when none is.',
    read: (snapshot) => scalar(snapshot.imagesOldestPendingSeconds),
  })
  defineSnapshotGauge({
    name: 'atlas_accounts',
    help: 'Accounts by state (total, verified, banned, trusted, two_factor, active_1d/7d/30d). Counts only.',
    labelNames: ['state'],
    read: (snapshot) => snapshot.usersByState,
  })
  defineSnapshotGauge({
    name: 'atlas_accounts_by_role',
    help: 'Accounts by role.',
    labelNames: ['role'],
    read: (snapshot) => snapshot.usersByRole,
  })
  defineSnapshotGauge({
    name: 'atlas_revisions',
    help: 'Revisions by review status.',
    labelNames: ['status'],
    read: (snapshot) => snapshot.revisionsByStatus,
  })
  defineSnapshotGauge({
    name: 'atlas_revisions_oldest_pending_seconds',
    help: 'Age of the oldest revision waiting for a moderator; 0 when none is.',
    read: (snapshot) => scalar(snapshot.revisionsOldestPendingSeconds),
  })
  defineSnapshotGauge({
    name: 'atlas_endorsements',
    help: 'Total "found this useful" endorsements.',
    read: (snapshot) => scalar(snapshot.endorsements),
  })
  defineSnapshotGauge({
    name: 'atlas_import_last_run_timestamp_seconds',
    help: 'Unix time of the newest recorded import run per upstream source.',
    labelNames: ['source'],
    read: (snapshot) => snapshot.importLastRunTimestamp,
  })
  defineSnapshotGauge({
    name: 'atlas_import_last_row_count',
    help: 'Rows written by the newest recorded import run per upstream source.',
    labelNames: ['source'],
    read: (snapshot) => snapshot.importLastRowCount,
  })
}
