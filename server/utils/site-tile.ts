import type { H3Event } from 'h3'
import type { TileCoordinate } from '#shared/types'

interface SiteTileOptions {
  showEverySite: boolean
}

/**
 * The hot path of the whole application. Everything visible on the map at a
 * given viewport arrives through this endpoint as one binary response per tile.
 *
 * Order matters: validate, then read cache, then hit Postgres. A malformed
 * coordinate must never reach the spatial query, and a cached tile must never
 * cost a connection from the pool.
 *
 * Serves the sites-and-tracings tile for both modes. The mode is a **path**
 * (`/api/tiles/every/...`), not a query string, because the pull zone in front
 * of this app ignores query strings in its cache key: with `?sites=all`, a
 * tile cached in one mode was handed back for the other, so switching the
 * density off left every-site markers drawn among the clusters.
 */
export const serveSiteTile = async (event: H3Event, options: SiteTileOptions) => {
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
  const renderOptions = { showEverySite: options.showEverySite }
  const cacheKey = buildTileCacheKey(tile, dataVersion, renderOptions)
  const redis = useRedis()

  setResponseHeaders(event, {
    'content-type': 'application/vnd.mapbox-vector-tile',
    'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    'x-data-version': String(dataVersion),
  })

  const plan = planTileRender(tile.z, renderOptions)
  const metricLabels = {
    zoom: String(tile.z),
    mode: renderOptions.showEverySite ? 'every' : 'clustered',
  }

  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) {
      setResponseHeader(event, 'x-tile-cache', 'hit')
      tileRequestsTotal().inc({ strategy: plan.strategy, cache: 'hit', ...metricLabels })
      tileResponseBytes().observe(
        { strategy: plan.strategy, zoom: metricLabels.zoom },
        cached.length,
      )
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
          compactSiteProperties: plan.compactSiteProperties,
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
  tileRequestsTotal().inc({ strategy: plan.strategy, cache: 'miss', ...metricLabels })
  tileResponseBytes().observe({ strategy: plan.strategy, zoom: metricLabels.zoom }, body.length)

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
}
