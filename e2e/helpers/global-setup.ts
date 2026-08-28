import { request } from '@playwright/test'
import { Redis } from 'ioredis'
import { seedAccounts } from './accounts'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3111'

/**
 * Waits until the application is genuinely able to serve, then seeds fixtures.
 *
 * `/api/ready` rather than `/api/health` on purpose: health answers as long as
 * the process is alive, while ready touches both Postgres pools and Valkey. A
 * suite that starts on health alone races the database connection and fails in
 * whichever test happens to run first — which is exactly the kind of flake that
 * gets a suite disabled instead of fixed.
 */
const waitForReady = async (timeoutMs = 120_000): Promise<void> => {
  const context = await request.newContext({ baseURL: BASE_URL })
  const deadline = Date.now() + timeoutMs
  let lastSeen = 'no response'

  try {
    while (Date.now() < deadline) {
      try {
        const response = await context.get('/api/ready', { timeout: 5_000 })
        if (response.ok()) return
        lastSeen = `${response.status()} ${JSON.stringify(await response.json())}`
      } catch (error) {
        lastSeen = (error as Error).message
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  } finally {
    await context.dispose()
  }

  throw new Error(
    `The application never became ready at ${BASE_URL}. Last response: ${lastSeen}.\n` +
      'Is the stack up? `pnpm stack:up && pnpm db:migrate`',
  )
}

/**
 * Renders the pages the suite opens first, so no test pays for a cold start.
 *
 * The first server-rendered request after a build is materially slower — module
 * graph, connection pools, prepared statements — and whichever test happens to
 * run first absorbs that. It then fails on a timeout that has nothing to do
 * with what it asserts, which is the most misleading kind of flake there is.
 */
const warmUp = async (): Promise<void> => {
  const context = await request.newContext({ baseURL: BASE_URL })
  try {
    for (const path of ['/', '/login', '/register']) {
      await context.get(path, { timeout: 30_000 }).catch(() => undefined)
    }
  } finally {
    await context.dispose()
  }
}

/**
 * Clears the rate-limit counters the previous run left behind.
 *
 * Each test presents its own `x-real-ip`, but the addresses are handed out by a
 * counter that restarts with the process — so test one always gets
 * `203.0.113.1`. Counters in Valkey outlive the run, and `login` permits eight
 * attempts per fifteen minutes, so running the suite three times in a row made
 * the login tests fail on the fourth. The failure then moved around depending
 * on how recently the suite had been run, which is the worst kind of flake:
 * real, reproducible, and apparently random.
 *
 * Only `rl:*` is removed. Tile caches and the data version are left alone —
 * they are expensive to rebuild and irrelevant to isolation.
 */
const clearRateLimits = async (): Promise<void> => {
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500)
      cursor = next
      if (keys.length > 0) await redis.del(...keys)
    } while (cursor !== '0')
  } catch (error) {
    throw new Error(`Could not clear rate limits in Valkey. Is \`pnpm stack:up\` running?`, {
      cause: error,
    })
  } finally {
    redis.disconnect()
  }
}

export default async (): Promise<void> => {
  await waitForReady()
  await clearRateLimits()
  await seedAccounts()
  await warmUp()
}
