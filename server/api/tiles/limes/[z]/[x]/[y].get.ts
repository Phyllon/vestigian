import type { TileCoordinate } from '#shared/types'

/**
 * The frontier as vector tiles: the named sectors of the limes and the
 * stretches that make them up.
 *
 * A sibling of `/api/tiles/antiquity` rather than two more layers inside it.
 * The frontier is drawn only when the reader asks for it, and folding it into
 * the atlas tile would charge everyone who never does. Same licence family
 * (AWMC, ODbL 1.0) and the same cache generation, so an import that rebuilds
 * one invalidates both.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'The Roman frontier as a vector tile',
    description:
      'Named sectors and their stretches, drawn over the Barrington sheet when "Follow the limes" is on. Rides the atlas cache generation.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'tiles')

  const params = getRouterParams(event)
  const tile: TileCoordinate = {
    z: Number(params.z),
    x: Number(params.x),
    y: Number(params.y?.replace(/\.mvt$/, '')),
  }

  if (!isValidTileCoordinate(tile)) {
    throw createError({ statusCode: 400, message: 'Tile coordinate out of range.' })
  }

  const atlasVersion = await getAtlasVersion()
  const cacheKey = buildLimesCacheKey(tile, atlasVersion)
  const redis = useRedis()

  setResponseHeaders(event, {
    'content-type': 'application/vnd.mapbox-vector-tile',
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    'x-atlas-version': String(atlasVersion),
  })

  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) {
      setResponseHeader(event, 'x-tile-cache', 'hit')
      tileRequestsTotal().inc({ strategy: 'limes', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'limes tile cache unreadable, falling through to postgres',
    )
  }

  const plan = planLimesRender(tile.z)
  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_limes_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildLimesTileSql({ tile, plan })),
    { attributes: { strategy: 'limes', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe({ strategy: 'limes' }, (performance.now() - renderStartedAt) / 1000)

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    /**
     * Almost all of this pyramid is empty, and far more of it than the atlas's:
     * the frontier is a line, so at zoom 12 the overwhelming majority of tiles
     * have nothing in them and never will without an import.
     */
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn({ err: { message: (error as Error).message } }, 'limes tile not cached')
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'limes', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
