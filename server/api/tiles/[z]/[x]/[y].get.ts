import type { TileCoordinate } from '#shared/types'

/**
 * The hot path of the whole application. Everything visible on the map at a
 * given viewport arrives through this endpoint as one binary response per tile.
 *
 * Order matters: validate, then read cache, then hit Postgres. A malformed
 * coordinate must never reach the spatial query, and a cached tile must never
 * cost a connection from the pool.
 */
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

  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) {
      setResponseHeader(event, 'x-tile-cache', 'hit')
      return cached
    }
  } catch {
    // Cache miss by outage — fall through to the database.
  }

  const plan = planTileRender(tile.z)
  const sql = useSql()

  const statement =
    plan.strategy === 'cluster'
      ? buildClusterTileSql({ tile, gridSize: plan.clusterGridSize })
      : buildFeatureTileSql({
          tile,
          simplifyTolerance: plan.simplifyTolerance,
          includeTracings: plan.includeTracings,
        })

  const rows = await sql.unsafe<{ tile: Buffer | null }[]>(statement)
  const body = rows[0]?.tile ?? Buffer.alloc(0)

  // An empty tile is still worth caching: most of the pyramid is ocean.
  try {
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 86400 : 3600)
  } catch {
    // Non-fatal.
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
