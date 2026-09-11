import type { TileCoordinate } from '#shared/types'

/**
 * Mirrored EDH inscriptions as vector tiles: worldwide, from the Epigraphic
 * Database Heidelberg — see `.claude/rules/epigraphy.md` for the source and
 * licence. A sibling of `/api/tiles/antiquity-ports` rather than a layer
 * inside `/api/tiles/antiquity`: most readers never turn "Show inscriptions"
 * on, and the marks are drawn over every basemap, not only the Barrington
 * sheet, so folding them into that endpoint would both overcharge the
 * common case and undercharge the actual one.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles', 'inscriptions'],
    summary: 'Mirrored EDH inscriptions as a vector tile',
    description:
      'Inscriptions carrying a resolved findspot, drawn when "Show inscriptions" is on. Rides the atlas cache generation.',
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
  const cacheKey = buildInscriptionCacheKey(tile, atlasVersion)
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
      tileRequestsTotal().inc({ strategy: 'inscriptions', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'inscription tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_inscription_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildInscriptionTileSql(tile)),
    { attributes: { strategy: 'inscriptions', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'inscriptions' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    // Most of this pyramid is empty, the same reasoning
    // `antiquity-ports/[z]/[x]/[y].get.ts` gives for its own points.
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'inscription tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'inscriptions', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
