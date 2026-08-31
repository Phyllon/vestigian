import type { TileCoordinate } from '#shared/types'

/**
 * The hot path of the whole application. Everything visible on the map at a
 * given viewport arrives through this endpoint as one binary response per tile.
 *
 * Order matters: validate, then read cache, then hit Postgres. A malformed
 * coordinate must never reach the spatial query, and a cached tile must never
 * cost a connection from the pool.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'Contributed sites and tracings as a vector tile',
    description:
      'The hot path of the application. Counted clusters below zoom 9, individual sites at 9+, tracings from zoom 7. Tiles carry id, slug, title and category only.',
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

  const dataVersion = await getDataVersion()
  const cacheKey = buildTileCacheKey(tile, dataVersion)
  const redis = useRedis()

  setResponseHeaders(event, {
    'content-type': 'application/vnd.mapbox-vector-tile',
    'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    'x-data-version': String(dataVersion),
  })

  const plan = planTileRender(tile.z)

  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) {
      setResponseHeader(event, 'x-tile-cache', 'hit')
      tileRequestsTotal().inc({ strategy: plan.strategy, cache: 'hit' })
      return cached
    }
  } catch (error) {
    // Cache miss by outage — fall through to the database. Logged because the
    // difference between a cold cache and an unreachable one is invisible in
    // the hit rate alone, and the second means every tile in the viewport is
    // now a PostGIS aggregate.
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()

  const statement =
    plan.strategy === 'cluster'
      ? buildClusterTileSql({ tile, gridSize: plan.clusterGridSize })
      : buildFeatureTileSql({
          tile,
          simplifyTolerance: plan.simplifyTolerance,
          includeTracings: plan.includeTracings,
        })

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(statement),
    // Zoom is bucketed by the strategy it selects, never recorded as a
    // coordinate: `z/x/y` as attributes would make every tile its own trace
    // dimension.
    {
      attributes: { strategy: plan.strategy, zoom: tile.z },
      parent: event.context.span,
    },
  )
  tileRenderDuration().observe(
    { strategy: plan.strategy },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  // An empty tile is still worth caching: most of the pyramid is ocean.
  try {
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 86400 : 3600)
  } catch (error) {
    // Non-fatal, but it means the next request for this tile pays the same
    // PostGIS cost again.
    event.context.log?.warn({ err: { message: (error as Error).message } }, 'tile not cached')
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: plan.strategy, cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
