import { z } from 'zod'
import type { ElevationProfile } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

/** A week; the terrain does not move and the key carries the data generation. */
const HIT_TTL_SECONDS = 604_800
const NOT_A_LINE_TTL_SECONDS = 86_400

/**
 * The relief along a tracing: elevation against distance, the climb and descent,
 * the steepest stretch. Read from the same terrain tiles as the hillshade and
 * "About this spot", so it is a model of the ground and not a survey of the road.
 *
 * Null for an area or a tracing that is not approved.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tracings'],
    summary: 'Elevation profile along a tracing',
    description:
      'Elevation against distance along an approved line tracing, with ascent, descent and gradient. Terrain-model values, not a survey; null for an area.',
  },
})

export default defineEventHandler(async (event): Promise<ElevationProfile | null> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  await enforceRateLimit(event, 'expensive')

  const cacheKey = `profile:m${PROFILE_MODEL_VERSION}:d${await getDataVersion()}:${id}`
  const redis = useRedis()

  setResponseHeader(event, 'cache-control', 'private, max-age=3600')

  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as ElevationProfile | null
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'profile cache unreadable, calculating',
    )
  }

  const profile = await computeElevationProfile({
    tracingId: id,
    terrainUrl: useRuntimeConfig(event).public.basemap.terrainUrl,
  })

  try {
    await redis.set(
      cacheKey,
      JSON.stringify(profile),
      'EX',
      profile ? HIT_TTL_SECONDS : NOT_A_LINE_TTL_SECONDS,
    )
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'profile could not be cached',
    )
  }

  return profile
})
