import { z } from 'zod'
import type { TowerSightlines } from '#shared/types'
import { SIGHTLINE_MODEL_VERSION } from '#shared/utils/sightline'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * A week for a calculation — the terrain does not move and the key already
 * carries both data generations — and a day for "this is not a frontier tower",
 * which a moderator could change by editing the record's kind.
 */
const HIT_TTL_SECONDS = 604_800
const NOT_A_TOWER_TTL_SECONDS = 86_400

/**
 * What a frontier watchtower could see, calculated from its guard platform over
 * the terrain model: the unbroken view in every direction at three assumed
 * heights, how far it reached, and whether the nearest other towers could be
 * seen from it.
 *
 * Null is an ordinary answer: most `watchtower` records are not on a frontier
 * (5,720 of 6,914 are Sardinian nuraghi) and have nothing to calculate.
 *
 * Addressed by site id and nothing else — never a free coordinate — so the number
 * of distinct answers is the number of towers, the cache is complete after one
 * pass, and the endpoint cannot be used as a general terrain calculator.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites', 'limes'],
    summary: 'Line of sight from a frontier watchtower',
    description:
      'The view from a Roman frontier tower’s guard platform over bare ground, at three assumed heights, with intervisibility to the nearest towers. A calculation, not a record; null when the site is not a watchtower on a limes sector.',
  },
})

export default defineEventHandler(async (event): Promise<TowerSightlines | null> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  await enforceRateLimit(event, 'expensive')

  const [dataVersion, atlasVersion] = await Promise.all([getDataVersion(), getAtlasVersion()])
  const cacheKey = `sightlines:m${SIGHTLINE_MODEL_VERSION}:d${dataVersion}:a${atlasVersion}:${id}`
  const redis = useRedis()

  setResponseHeader(event, 'cache-control', 'private, max-age=3600')

  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as TowerSightlines | null
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'sightlines cache unreadable, calculating',
    )
  }

  const sightlines = await computeTowerSightlines({
    siteId: id,
    terrainUrl: useRuntimeConfig(event).public.basemap.terrainUrl,
  })

  try {
    await redis.set(
      cacheKey,
      JSON.stringify(sightlines),
      'EX',
      sightlines ? HIT_TTL_SECONDS : NOT_A_TOWER_TTL_SECONDS,
    )
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'sightlines could not be cached',
    )
  }

  return sightlines
})
