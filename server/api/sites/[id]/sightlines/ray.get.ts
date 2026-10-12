import { z } from 'zod'
import { COMPASS_POINTS } from '#shared/types'
import type { TowerRaySection } from '#shared/types'
import { SIGHTLINE_MODEL_VERSION } from '#shared/utils/sightline'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * Only the eight compass lines, never a free bearing: the number of distinct
 * answers is eight per tower, so the cache is complete after a pass and the
 * endpoint cannot be walked round the compass to read the terrain a degree at a
 * time.
 */
export const querySchema = z.object({ compass: z.enum(COMPASS_POINTS) })

const HIT_TTL_SECONDS = 604_800
const NOT_A_TOWER_TTL_SECONDS = 86_400

/**
 * The ground along one compass line out from a frontier tower, against the
 * sentry's eyes: which stretches are seen and which hidden, the crest that ends
 * the unbroken view, and where ground comes back into view. The numbers behind
 * one spoke of the tower's polar diagram.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites', 'limes'],
    summary: 'The ground along one compass line from a frontier watchtower',
    description:
      'Elevation along one of the eight compass lines, with the stretches seen and hidden from the guard platform at the middle height estimate and the crest that ends the view. Null when the site is not a watchtower on a limes sector.',
  },
})

export default defineEventHandler(async (event): Promise<TowerRaySection | null> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { compass } = await getValidatedQuery(event, querySchema.parse)
  await enforceRateLimit(event, 'enrichment')

  const [dataVersion, atlasVersion] = await Promise.all([getDataVersion(), getAtlasVersion()])
  const cacheKey = `sightray:m${SIGHTLINE_MODEL_VERSION}:d${dataVersion}:a${atlasVersion}:${id}:${compass}`
  const redis = useRedis()

  setResponseHeader(event, 'cache-control', 'private, max-age=3600')

  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as TowerRaySection | null
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'ray cache unreadable, calculating',
    )
  }

  const section = await computeTowerRay({
    siteId: id,
    compass,
    terrainUrl: useRuntimeConfig(event).public.basemap.terrainUrl,
  })

  try {
    await redis.set(
      cacheKey,
      JSON.stringify(section),
      'EX',
      section ? HIT_TTL_SECONDS : NOT_A_TOWER_TTL_SECONDS,
    )
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'ray could not be cached',
    )
  }

  return section
})
