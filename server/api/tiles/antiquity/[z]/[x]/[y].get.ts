import type { TileCoordinate } from '#shared/types'

/**
 * The antiquity atlas as vector tiles: ancient coastline and open water, Roman
 * roads, aqueducts, canals, walls, urban extents, region and people names, and
 * Pleiades places.
 *
 * A sibling of `/api/tiles` rather than another layer inside it. The data is
 * third-party and separately licensed (AWMC, ODbL 1.0; Pleiades, CC BY 3.0),
 * and it is rebuilt by an import rather than edited — so it carries its own
 * cache generation and survives every approval, where the site pyramid does not.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'The Barrington sheet as a vector tile',
    description:
      "AWMC's Barrington-derived geodata (ODbL 1.0) and Pleiades places (CC BY 3.0). Rebuilt only by an import, so it carries its own cache generation.",
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
  const cacheKey = buildAtlasCacheKey(tile, atlasVersion)
  const redis = useRedis()

  setResponseHeaders(event, {
    'content-type': 'application/vnd.mapbox-vector-tile',
    // Longer than the site pyramid's hour: this changes only when someone runs
    // the import, and the version prefix is what makes that visible.
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    'x-atlas-version': String(atlasVersion),
  })

  try {
    const cached = await redis.getBuffer(cacheKey)
    if (cached) {
      setResponseHeader(event, 'x-tile-cache', 'hit')
      tileRequestsTotal().inc({ strategy: 'atlas', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'atlas tile cache unreadable, falling through to postgres',
    )
  }

  const plan = planAtlasRender(tile.z)
  const sql = useSql()

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_atlas_tile',
    () => sql.unsafe<{ tile: Buffer | null }[]>(buildAtlasTileSql({ tile, plan })),
    { attributes: { strategy: 'atlas', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe({ strategy: 'atlas' }, (performance.now() - renderStartedAt) / 1000)

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    // A month for an empty tile. Most of this pyramid is ocean or outside the
    // Barrington's coverage, and neither becomes populated without an import.
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn({ err: { message: (error as Error).message } }, 'atlas tile not cached')
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'atlas', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
