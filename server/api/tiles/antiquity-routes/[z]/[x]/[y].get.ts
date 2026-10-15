import type { TileCoordinate } from '#shared/types'

/**
 * The ORBIS route network as vector tiles: worldwide — see
 * `scripts/import/15-orbis-routes.ts` for the source and licence. A
 * sibling of `/api/tiles/antiquity-battles` rather than a layer inside
 * `/api/tiles/antiquity`: most readers never turn "Show ancient routes"
 * on, and the lines are drawn over every basemap, not only the Barrington
 * sheet, so folding them into that endpoint would both overcharge the
 * common case and undercharge the actual one.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'The ORBIS route network as a vector tile',
    description:
      'Roman-era road, river and sea routes, drawn when "Show ancient routes" is on. Rides the atlas cache generation.',
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
  const cacheKey = buildRouteCacheKey(tile, atlasVersion)
  const redis = useRedis()

  setResponseHeaders(event, {
    'content-type': 'application/vnd.mapbox-vector-tile',
    'cache-control': atlasTileCacheControl(),
    'x-atlas-version': String(atlasVersion),
  })

  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) {
      setResponseHeader(event, 'x-tile-cache', 'hit')
      tileRequestsTotal().inc({ strategy: 'routes', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'route tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_route_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildRouteTileSql(tile)),
    { attributes: { strategy: 'routes', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe({ strategy: 'routes' }, (performance.now() - renderStartedAt) / 1000)

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    // Most of this pyramid is empty, the same reasoning
    // `antiquity-battles/[z]/[x]/[y].get.ts` gives for its own points.
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn({ err: { message: (error as Error).message } }, 'route tile not cached')
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'routes', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
