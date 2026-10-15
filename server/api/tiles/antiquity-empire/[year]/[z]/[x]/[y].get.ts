import type { TileCoordinate } from '#shared/types'

/**
 * The Roman state's extent in a given year, as a vector tile fill: the layer
 * the Barrington sheet gains when a reader drags the period scrubber.
 *
 * A sibling of `/api/tiles/antiquity` and `/api/tiles/limes` rather than a
 * third layer folded into either, for the reason given on
 * `buildEmpireExtentTileSql`. Same cache generation as the rest of the atlas,
 * so an import that rebuilds one invalidates all three.
 *
 * Unlike the AWMC-backed route this replaces, the path carries a **year**,
 * not one of three fixed snapshot dates — the source is a continuous series
 * of intervals, and the query asks which of them contain that year. See
 * `19-ohm-empire-extents.ts`.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'The Roman state extent in a given year, as a vector tile',
    description:
      'Drawn over the Barrington sheet when a reader moves the period scrubber. The year is any point between 509 BCE and 476 CE, written as a signed integer (-509 is 509 BCE). Rides the atlas cache generation.',
  },
})

/** The span `19-ohm-empire-extents.ts` imports: the traditional founding of
 *  the Republic to the deposition of Romulus Augustulus. A range check, not
 *  the allowlist the three-snapshot route could use, since every year in
 *  between is now a legitimate request — the value still reaches SQL only
 *  through a parameterised builder, and is proven an integer first. */
const EARLIEST_YEAR = -509
const LATEST_YEAR = 476

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'tiles')

  const params = getRouterParams(event)
  const year = Number(params.year)
  if (!Number.isInteger(year) || year < EARLIEST_YEAR || year > LATEST_YEAR) {
    throw createError({ statusCode: 400, message: 'Year outside the imported range.' })
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
  const cacheKey = buildEmpireExtentCacheKey(tile, atlasVersion, year)
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
      tileRequestsTotal().inc({ strategy: 'antiquity-empire', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'empire extent tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()
  const simplifyTolerance = getSimplifyTolerance(tile.z)

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_empire_extent_tile',
    () =>
      sql.unsafe<{ tile: Buffer | null }[]>(
        buildEmpireExtentTileSql({ tile, year, simplifyTolerance }),
      ),
    { attributes: { strategy: 'antiquity-empire', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'antiquity-empire' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'empire extent tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'antiquity-empire', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
