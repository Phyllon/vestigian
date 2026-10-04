import { Redis } from 'ioredis'

const ATLAS_VERSION_KEY = 'vestigian:atlas-version'

/**
 * Tell the running app that an atlas table was rebuilt.
 *
 * Every cached atlas tile is stored under a key that contains the **atlas generation**, a
 * counter in Valkey (`vestigian:atlas-version`, read by `getAtlasVersion` in
 * `server/utils/cache.ts`; an unset counter reads as 1). Changing the counter makes every
 * layer's old tiles unreachable at once, because readers now ask for different keys. This
 * bumps it **upwards, always**, and removes this layer's own cached tiles as well.
 *
 * What it replaces, in a dozen older scripts, was `DEL` followed by `INCR`. That leaves the
 * counter at 1 whatever it was, so the generation went *down* after an import, and tiles cached
 * under an earlier visit to generation 1 (up to a week for a drawn tile, thirty days for an
 * empty one) came back to life with stale data. It was written on the belief that an unset
 * counter needs clearing first; it does not, but it does need to land on a *different* number
 * than the one it effectively held, which is what `INCRBY 2` on an unset counter does below
 * (an unset counter means 1, so the first bump must reach 2, not 1).
 *
 * `keyPatterns` are glob patterns of the tile keys the rebuilt table feeds (`port:v*`,
 * `atlas:v*:empire:*`). They are removed with `SCAN` + `UNLINK`, never `KEYS`, so a large
 * cache is not blocked. Pass an empty list for a table no tile reads.
 *
 * Never throws: an import that wrote its rows has succeeded, and a Redis outage should be
 * reported, not turned into a failed run.
 */
export const refreshAtlasCache = async (keyPatterns: readonly string[]): Promise<void> => {
  const redis = new Redis(process.env.NUXT_REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    const version =
      (await redis.exists(ATLAS_VERSION_KEY)) === 1
        ? await redis.incr(ATLAS_VERSION_KEY)
        : await redis.incrby(ATLAS_VERSION_KEY, 2)

    let purged = 0
    for (const pattern of keyPatterns) {
      for await (const keys of redis.scanStream({ match: pattern, count: 500 }) as AsyncIterable<
        string[]
      >) {
        if (keys.length === 0) continue
        purged += await redis.unlink(...keys)
      }
    }

    console.log(`Atlas cache generation is now ${version}; ${purged} cached tiles dropped.`)
  } catch (error) {
    console.warn(
      `Imported, but the cache could not be refreshed (${(error as Error).message}). ` +
        `Until it is, the map may keep serving the previous tiles.`,
    )
  } finally {
    redis.disconnect()
  }
}
