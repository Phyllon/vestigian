/**
 * Deletes every `rl:*` key in Valkey — the rate-limit counters `enforceRateLimit`
 * writes (`server/utils/ratelimit.ts`), keyed per policy and identifier.
 *
 * Exists for the e2e suite's own test-IP pool: `e2e/helpers/fixtures.ts` hands
 * out addresses from 203.0.113.0/24 in a fixed order, restarting at .1 every
 * run, so repeated runs inside one window (`login` is 8/15min, `register` is
 * 4/hour) keep re-spending the *same* budget rather than getting a fresh one.
 * Past a few runs, tests that expect a 200 start legitimately getting a 429
 * from a previous run's leftovers — indistinguishable from a real rate-limit
 * bug until you check what's actually in Valkey. `pnpm flush-rate-limits`
 * clears the slate; run it before `pnpm test:e2e` if the suite has been run
 * more than once or twice in the last hour.
 *
 * Uses `SCAN`, not `KEYS` — non-blocking, and safe to run against a live
 * cache. Only ever point this at a dev/test `NUXT_REDIS_URL`: run against
 * production it would reset every real visitor's rate-limit budget at once.
 */
import { Redis } from 'ioredis'

const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379')

const main = async (): Promise<void> => {
  const stream = redis.scanStream({ match: 'rl:*', count: 100 })
  let deleted = 0

  for await (const keys of stream) {
    if (keys.length === 0) continue
    await redis.del(...keys)
    deleted += keys.length
  }

  console.log(`Flushed ${deleted} rate-limit key${deleted === 1 ? '' : 's'}.`)
  await redis.quit()
}

await main()
