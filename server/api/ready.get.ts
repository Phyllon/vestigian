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
  } catch {
    /* reported below */
  }

  try {
    await useRedis().ping()
    checks.cache = true
  } catch {
    /* reported below */
  }

  if (!checks.database) {
    setResponseStatus(event, 503)
  }

  return { status: checks.database ? 'ready' : 'degraded', checks }
})
