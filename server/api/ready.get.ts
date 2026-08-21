/**
 * Readiness. Traefik and any future orchestrator use this to decide whether to
 * route traffic, so it must actually touch both backing services.
 */
export default defineEventHandler(async (event) => {
  const checks = { database: false, cache: false }

  try {
    await useSql()`SELECT 1`
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
