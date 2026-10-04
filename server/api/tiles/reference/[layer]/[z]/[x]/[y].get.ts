import type { TileCoordinate } from '#shared/types'

/**
 * The reference overlays that share one tile shape: Itiner-e Roman roads,
 * Nomisma mints, the Wikidata monuments and the I.Sicily inscriptions. See
 * `server/utils/reference-layers.ts` for why they are one endpoint, and each
 * import script (`21`–`24`) for the source and licence of its layer.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'A reference overlay layer as a vector tile',
    description:
      'One of roman-roads (Itiner-e, CC BY 4.0), mints (Nomisma, CC BY 3.0), monuments (Wikidata, CC0) or isicily (I.Sicily, CC BY 4.0). Drawn when the matching switch in the overlay menu is on. Rides the atlas cache generation.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'tiles')

  const params = getRouterParams(event)
  const layer = params.layer ?? ''
  if (!isReferenceLayerId(layer)) {
    throw createError({ statusCode: 404, message: 'Unknown reference layer.' })
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
  const cacheKey = buildReferenceCacheKey(layer, tile, atlasVersion)
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
      tileRequestsTotal().inc({ strategy: layer, cache: 'hit' })
      return cached
    }
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message }, layer },
      'reference tile cache unreadable, falling through to postgres',
    )
  }

  const sql = useSql()
  const simplifyTolerance = getSimplifyTolerance(tile.z)

  const renderStartedAt = performance.now()
  const rows = await withSpan(
    'postgis.render_reference_tile',
    () =>
      sql.unsafe<{ tile: Buffer | null }[]>(
        buildReferenceTileSql({ layer, tile, simplifyTolerance }),
      ),
    { attributes: { strategy: layer, zoom: tile.z }, parent: event.context.span },
  )
  tileRenderDuration().observe({ strategy: layer }, (performance.now() - renderStartedAt) / 1000)

  const body = rows[0]?.tile ?? Buffer.alloc(0)

  try {
    // Most of any of these pyramids is empty, so an empty tile is kept a long time.
    await redis.set(cacheKey, body, 'EX', body.length === 0 ? 2592000 : 604800)
  } catch (error) {
    event.context.log?.warn(
      { err: { message: (error as Error).message }, layer },
      'reference tile not cached',
    )
  }

  setResponseHeader(event, 'x-tile-cache', 'miss')
  tileRequestsTotal().inc({ strategy: layer, cache: 'miss' })

  if (body.length === 0) {
    setResponseStatus(event, 204)
    return null
  }

  return body
})
