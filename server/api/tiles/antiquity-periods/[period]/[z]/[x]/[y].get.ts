import type { TileCoordinate } from '#shared/types'

/**
 * The empire's extent at one of three dates, as a vector tile fill: the layer
 * the Barrington sheet gains when a reader drags the period scrubber.
 *
 * A sibling of `/api/tiles/antiquity` and `/api/tiles/limes` rather than a
 * third layer folded into either. Same licence family (AWMC, ODbL 1.0, see
 * `12-antiquity-periods.ts`) and the same cache generation, so an import
 * that rebuilds one invalidates all three.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'The Roman Empire extent at one of three dates, as a vector tile',
    description:
      'Drawn over the Barrington sheet when a reader moves the period scrubber to 60 BCE, 117 CE or 200 CE. Rides the atlas cache generation.',
  },
})

/** The only three dates `12-antiquity-periods.ts` actually imports — an
 *  allowlist, not a range check, since the route param reaches raw SQL. */
const VALID_PERIOD_YEARS = new Set([-60, 117, 200])

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'tiles')

  const params = getRouterParams(event)
  const periodYear = Number(params.period)
  if (!VALID_PERIOD_YEARS.has(periodYear)) {
    throw createError({ statusCode: 400, message: 'Unknown period.' })
  }

  const tile: TileCoordinate = {
    z: Number(params.z),
    x: Number(params.x),
    y: Number(params.y?.replace(/\.mvt$/, '')),
  }

  if (!isValidTileCoordinate(tile)) {
    throw createError({ statusCode: 400, message: 'Tile coordinate out of range.' })
  }

  const atlasVersion = await getAtlasVersion()
  const cacheKey = buildPeriodExtentCacheKey(tile, atlasVersion, periodYear)
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
      tileRequestsTotal().inc({ strategy: 'antiquity-period', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'period extent tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()
  const simplifyTolerance = getSimplifyTolerance(tile.z)

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_period_extent_tile',
    () =>
      sql.unsafe<{ tile: Buffer | null }[]>(
        buildPeriodExtentTileSql({ tile, periodYear, simplifyTolerance }),
      ),
    { attributes: { strategy: 'antiquity-period', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'antiquity-period' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'period extent tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'antiquity-period', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
