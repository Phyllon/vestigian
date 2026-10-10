import { z } from 'zod'
import type { SpotContext } from '#shared/types'
import { snapCoordinate } from '#shared/utils/spot'

export const querySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
})

/**
 * A week. The answers move only when an import replaces the towns, the borders,
 * the extents or the terrain; the atlas version in the key covers the imports
 * that bump it, and this bounds the ones that do not.
 */
const CACHE_SECONDS = 604_800

/**
 * What can be said about a spot from its coordinate alone — nearest town,
 * country, elevation, and the years the Roman state's recorded extent covered it.
 *
 * Called when a reader opens "About this spot" in a reference mark's info box,
 * with the *mark's* coordinate. The reader's own position is never sent: the
 * distance from them is worked out in the browser.
 *
 * `cache-control` is `private`, not `public`: this takes its input from the
 * query string, and the CDN in front of the site ignores query strings in its
 * cache key (runbook §9) — a public response would be served to every other
 * spot.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'What can be derived about a coordinate',
    description:
      'Nearest town, country, elevation and the years the Roman state’s recorded extent covers the point. Computed from the coordinate alone; nothing about the caller is read.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const { lon, lat } = await getValidatedQuery(event, querySchema.parse)

  const snapped = { lon: snapCoordinate(lon), lat: snapCoordinate(lat) }
  const cacheKey = `spot:v${await getAtlasVersion()}:${snapped.lon}:${snapped.lat}`
  const redis = useRedis()

  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      setResponseHeader(event, 'cache-control', 'private, max-age=3600')
      return JSON.parse(cached) as SpotContext
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'spot cache unreadable, falling through to the sources',
    )
  }

  const failedParts: string[] = []
  const context = await readSpotContext({
    ...snapped,
    terrainUrl: useRuntimeConfig(event).public.basemap.terrainUrl,
    onPartFailure: (part, error) => {
      failedParts.push(part)
      event.context.log?.warn(
        { err: { message: (error as Error).message }, part },
        'spot part failed',
      )
    },
  })

  // A partial answer is worth giving but not worth keeping for a week: the part
  // that failed (a slow terrain host, a dropped connection) will usually work
  // on the next ask.
  if (failedParts.length > 0) {
    setResponseHeader(event, 'cache-control', 'no-store')
    return context
  }

  try {
    await redis.set(cacheKey, JSON.stringify(context), 'EX', CACHE_SECONDS)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'spot answer could not be cached',
    )
  }

  setResponseHeader(event, 'cache-control', 'private, max-age=3600')
  return context
})
