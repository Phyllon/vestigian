import type { TileCoordinate } from '#shared/types'

/**
 * Ancient battles as vector tiles: worldwide, before year 500 — see
 * `scripts/import/13-battles.ts` for the source and cutoff. A sibling of
 * `/api/tiles/limes` rather than a layer inside `/api/tiles/antiquity`:
 * most readers never turn "Show battles" on, and the marks are drawn over
 * every basemap, not only the Barrington sheet, so folding them into that
 * endpoint would both overcharge the common case and undercharge the
 * actual one.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'Ancient battles as a vector tile',
    description:
      'Battles before year 500, worldwide, drawn when "Show battles" is on. Rides the atlas cache generation.',
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
  const cacheKey = buildBattleCacheKey(tile, atlasVersion)
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
      tileRequestsTotal().inc({ strategy: 'battles', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'battle tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_battle_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildBattleTileSql(tile)),
    { attributes: { strategy: 'battles', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'battles' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    // Most of this pyramid is empty: ~490 points worldwide leave almost every
    // tile blank, the same reasoning `limes/[z]/[x]/[y].get.ts` gives.
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'battle tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'battles', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
