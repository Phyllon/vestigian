import { sql } from 'drizzle-orm'

/**
 * Readiness. Traefik and any future orchestrator use this to decide whether to
 * route traffic, so it must actually touch both backing services.
 *
 * Both database pools are probed, not one. `useSql()` and `useDatabase()` hold
 * separate connections — see the note in `server/utils/db.ts` — so a pool that
 * cannot reach Postgres while the other can would otherwise report ready and
 * take traffic that fails on the half nothing checked.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const checks = { database: false, cache: false }

  try {
    await Promise.all([useSql()`SELECT 1`, useDatabase().execute(sql`SELECT 1`)])
    checks.database = true
  } catch (error) {
    event.context.log.error(
      { err: { message: (error as Error).message } },
      'readiness: postgres unreachable',
    )
  }

  try {
    await useRedis().ping()
    checks.cache = true
  } catch (error) {
    event.context.log.error(
      { err: { message: (error as Error).message } },
      'readiness: valkey unreachable',
    )
  }

  /**
   * The cache counts towards readiness, which it did not used to.
   *
   * Reporting `ready` on a Postgres connection alone meant a total Valkey
   * outage kept the container in the load balancer while every tile fell
   * through to PostGIS **and** `enforceRateLimit` failed open on every policy —
   * the two failure modes that most want traffic sent elsewhere. Postgres is
   * still the harder dependency; the difference is that neither is now
   * survivable in silence.
   */
  const ready = checks.database && checks.cache

  if (!ready) {
    setResponseStatus(event, 503)
  }

  return { status: ready ? 'ready' : 'degraded', checks }
})
