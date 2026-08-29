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
    redis.on('error', (error) =>
      useLogger().error({ err: { message: error.message } }, 'cache connection error'),
    )
  }
  return redis
}

const DATA_VERSION_KEY = 'vestigia:data-version'

export const getDataVersion = async (): Promise<number> => {
  try {
    const raw = await useRedis().get(DATA_VERSION_KEY)
    return raw ? Number(raw) : 1
  } catch (error) {
    // Falling back to version 1 means every tile key resolves to the version
    // the cache held when it was empty, so readers can be served tiles built
    // before edits they should already be seeing.
    useLogger().warn(
      { err: { message: (error as Error).message } },
      'data version unreadable, serving tiles as version 1',
    )
    return 1
  }
}

const ATLAS_VERSION_KEY = 'vestigia:atlas-version'

/**
 * The antiquity atlas has its own generation because it changes on a completely
 * different clock: a moderator approving a photograph must not throw away a
 * pyramid of coastline and Roman road tiles that nothing touched.
 */
export const getAtlasVersion = async (): Promise<number> => {
  try {
    const raw = await useRedis().get(ATLAS_VERSION_KEY)
    return raw ? Number(raw) : 1
  } catch (error) {
    useLogger().warn(
      { err: { message: (error as Error).message } },
      'atlas version unreadable, serving atlas tiles as version 1',
    )
    return 1
  }
}

/** Called by `pnpm import:atlas` once a rebuild has finished. */
export const bumpAtlasVersion = async (): Promise<number> => {
  try {
    return await useRedis().incr(ATLAS_VERSION_KEY)
  } catch (error) {
    useLogger().error(
      { err: { message: (error as Error).message } },
      'atlas cache not invalidated: a rebuilt atlas may not reach the map',
    )
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
  } catch (error) {
    // This is the quiet one. An approval that cannot bump the counter leaves
    // every cached tile keyed to the old version, so the contribution is live
    // in Postgres and invisible on the map until something else bumps it — with
    // no error surfaced to the moderator who approved it.
    useLogger().error(
      { err: { message: (error as Error).message } },
      'tile cache not invalidated: approved changes may not reach the map',
    )
    return 1
  }
}
