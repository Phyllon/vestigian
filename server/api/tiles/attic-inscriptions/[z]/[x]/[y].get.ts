import type { TileCoordinate } from '#shared/types'

/**
 * Attic Inscriptions Online as vector tiles — see `.claude/rules/
 * epigraphy.md` for the source and licence. A sibling of
 * `/api/tiles/inscriptions` rather than folded into it: two separate
 * tables with no shared row identity, and most readers switch on at most
 * one of the two "Show inscriptions" layers at a time.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles', 'inscriptions'],
    summary: 'Attic Inscriptions Online as a vector tile',
    description:
      'Attic inscriptions carrying a resolved findspot, drawn when "Show Attic inscriptions" is on. Rides the atlas cache generation.',
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
  const cacheKey = buildAtticInscriptionCacheKey(tile, atlasVersion)
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
      tileRequestsTotal().inc({ strategy: 'attic-inscriptions', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'attic inscription tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_attic_inscription_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildAtticInscriptionTileSql(tile)),
    { attributes: { strategy: 'attic-inscriptions', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'attic-inscriptions' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'attic inscription tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'attic-inscriptions', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
