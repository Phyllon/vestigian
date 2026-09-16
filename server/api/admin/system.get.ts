import { count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { revisions, siteImages, sites, tracings, users } from '~~/server/database/schema'

/**
 * Which process-level counters are worth a screen, and nothing else.
 *
 * `/api/metrics` already exports everything; what an administrator needs is the
 * handful whose value is a problem rather than a datum. `mail_deliveries_total`
 * leads because mail delivery **never throws** by design — a provider outage
 * turns into a counter increment and absolutely nothing else, so a broken
 * verification mail is currently silent unless somebody has Grafana open. An
 * atlas whose signups quietly stop working is exactly the failure this is for.
 */
const SURFACED_METRICS = new Set([
  'mail_deliveries_total',
  'auth_events_total',
  'rate_limit_decisions_total',
  'moderation_actions_total',
])

/**
 * What is wrong right now, in one response.
 *
 * Not a replacement for Grafana, and deliberately not a log viewer: it answers
 * the questions an administrator has while already looking at the panel — is
 * anything queued, is anything unpublishable, did mail stop working, are the
 * backing services up — without a second stack to bring up and a dashboard to
 * find.
 */
defineRouteMeta({
  openAPI: {
    tags: ['admin'],
    summary: 'Readiness, backlog counts and the operational counters worth a screen',
    description:
      'Admin only. Probes both database pools and the cache the way /api/ready does, counts what is waiting for attention, and reads four counters out of the Prometheus registry — including failed mail deliveries, which are otherwise visible only in Grafana.',
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await enforceRateLimit(event, 'admin')

  const database = useDatabase()
  const checks = { database: false, cache: false }

  /**
   * Both pools, exactly as `ready.get.ts` does and for the reason its own
   * docstring gives: `useSql()` and `useDatabase()` hold separate connections,
   * so one that cannot reach Postgres while the other can would otherwise
   * report healthy.
   */
  try {
    await Promise.all([useSql()`SELECT 1`, database.execute(sql`SELECT 1`)])
    checks.database = true
  } catch (error) {
    event.context.log.error(
      { err: { message: (error as Error).message } },
      'admin system: postgres unreachable',
    )
  }

  let dataVersion: number | null = null

  try {
    dataVersion = await getDataVersion()
    checks.cache = true
  } catch (error) {
    event.context.log.error(
      { err: { message: (error as Error).message } },
      'admin system: valkey unreachable',
    )
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [attention] = await database
    .select({
      pendingRevisions: sql<number>`(SELECT count(*)::int FROM ${revisions} WHERE ${eq(revisions.status, 'pending')})`,
      pendingImages: sql<number>`(SELECT count(*)::int FROM ${siteImages} WHERE ${eq(siteImages.status, 'pending')})`,
      unresolvedLicences: sql<number>`(
        SELECT count(*)::int FROM ${siteImages}
        WHERE ${siteImages.licence} IN ('UNKNOWN', 'ARR') AND ${siteImages.status} <> 'rejected'
      )`,
      blockedAccounts: sql<number>`(SELECT count(*)::int FROM ${users} WHERE ${isNotNull(users.bannedAt)})`,
      revokedTrust: sql<number>`(SELECT count(*)::int FROM ${users} WHERE ${eq(users.trustRevoked, true)})`,
      /**
       * Two signup-abuse signals, assembled from data already stored rather
       * than from anything new: a burst of fresh accounts, and accounts that
       * never confirmed an address. Neither is proof of anything on its own —
       * they are the shape of an automated signup run, which is what an
       * administrator wants to notice early.
       */
      accountsLastDay: sql<number>`(SELECT count(*)::int FROM ${users} WHERE ${gte(users.createdAt, dayAgo)})`,
      unverifiedAccounts: sql<number>`(SELECT count(*)::int FROM ${users} WHERE ${isNull(users.emailVerifiedAt)})`,
      publishedSites: sql<number>`(SELECT count(*)::int FROM ${sites} WHERE ${eq(sites.status, 'approved')})`,
      publishedTracings: sql<number>`(SELECT count(*)::int FROM ${tracings} WHERE ${eq(tracings.status, 'approved')})`,
    })
    .from(users)
    .limit(1)

  const [accountTotal] = await database.select({ total: count() }).from(users)

  /**
   * Read from the registry the scrape endpoint serves, so these numbers are
   * the same ones Prometheus sees rather than a second count kept in parallel.
   * Note they are **process-lifetime** counters, not rates: they reset when the
   * container restarts, which is worth saying in the interface rather than
   * letting someone read a low number as good news after a deploy.
   */
  const metrics = await useMetrics().getMetricsAsJSON()

  const counters = metrics
    .filter((metric) => SURFACED_METRICS.has(metric.name))
    .map((metric) => ({
      name: metric.name,
      help: metric.help,
      series: (metric as { values?: { labels: Record<string, unknown>; value: number }[] }).values
        ?.map((entry) => ({ labels: entry.labels, value: entry.value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 20),
    }))

  return {
    status: checks.database && checks.cache ? ('ready' as const) : ('degraded' as const),
    checks,
    dataVersion,
    uptimeSeconds: Math.round(process.uptime()),
    attention: { ...attention, accounts: Number(accountTotal?.total ?? 0) },
    counters,
  }
})
