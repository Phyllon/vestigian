import type { TileCoordinate } from '#shared/types'

/**
 * CHRR coin-hoard findspots as vector tiles: worldwide — see
 * `scripts/import/18-chrr-coin-hoards.ts` for the source and licence. A
 * sibling of `/api/tiles/antiquity-battles` rather than a layer inside
 * `/api/tiles/antiquity`: most readers never turn "Show coin hoards" on,
 * and the marks are drawn over every basemap, not only the Barrington
 * sheet.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'CHRR coin-hoard findspots as a vector tile',
    description:
      'Coin-hoard findspots from Coin Hoards of the Roman Republic, drawn when "Show coin hoards" is on. Rides the atlas cache generation.',
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
  const cacheKey = buildCoinHoardCacheKey(tile, atlasVersion)
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
      tileRequestsTotal().inc({ strategy: 'coin-hoards', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'coin hoard tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_coin_hoard_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildCoinHoardTileSql(tile)),
    { attributes: { strategy: 'coin-hoards', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'coin-hoards' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    // Most of this pyramid is empty, the same reasoning
    // `antiquity-battles/[z]/[x]/[y].get.ts` gives for its own points.
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'coin hoard tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'coin-hoards', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
