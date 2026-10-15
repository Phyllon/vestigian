import type { TileCoordinate } from '#shared/types'

/**
 * The neighbours of the Roman state in a given year, as a vector tile fill —
 * Carthage, the Hellenistic kingdoms, Parthia, Pontus, the Goths and others, from
 * Cliopatria (`scripts/import/25-cliopatria-polities.ts`, CC BY 4.0). Drawn under
 * the Roman extent while the period scrubber is on. The year is in the path, like
 * `antiquity-empire`, so each year is its own cacheable tile.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'The neighbours of the Roman state in a given year, as a vector tile',
    description:
      'Cliopatria polity boundaries (CC BY 4.0) valid in the given year, written as a signed integer between -509 and 476 (-509 is 509 BCE). Rides the atlas cache generation.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'tiles')

  const params = getRouterParams(event)
  const year = Number(params.year)
  if (!Number.isInteger(year) || year < POLITY_EARLIEST_YEAR || year > POLITY_LATEST_YEAR) {
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
  const cacheKey = buildPolityCacheKey(tile, atlasVersion, year)
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
      tileRequestsTotal().inc({ strategy: 'polities', cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'polity tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()
  const simplifyTolerance = getSimplifyTolerance(tile.z)

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_polity_tile',
    () =>
      sql.unsafe<{ tile: Buffer | null }[]>(buildPolityTileSql({ tile, year, simplifyTolerance })),
    { attributes: { strategy: 'polities', zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe(
    { strategy: 'polities' },
    (performance.now() - renderStartedAt) / 1000,
  )

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message } },
      'polity tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: 'polities', cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
