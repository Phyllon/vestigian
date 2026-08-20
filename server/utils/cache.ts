import { Redis } from 'ioredis'

let redis: Redis | undefined

export const useRedis = (): Redis => {
  if (!redis) {
    const { redisUrl } = useRuntimeConfig()
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
    // A cache outage must degrade performance, never availability.
    redis.on('error', (error) => console.error('[cache]', error.message))
  }
  return redis
}

const DATA_VERSION_KEY = 'vestigia:data-version'

export const getDataVersion = async (): Promise<number> => {
  try {
    const raw = await useRedis().get(DATA_VERSION_KEY)
    return raw ? Number(raw) : 1
  } catch {
    return 1
  }
}

/**
 * Called whenever a revision is approved. Bumping one counter invalidates every
 * cached tile, which is the right trade: approvals are rare, tile reads are not.
 */
export const bumpDataVersion = async (): Promise<number> => {
  try {
    return await useRedis().incr(DATA_VERSION_KEY)
  } catch {
    return 1
  }
}
