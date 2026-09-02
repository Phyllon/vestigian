import type { TileCoordinate } from '#shared/types'

/**
 * A single production basemap tile, read out of the PMTiles archive
 * server-side. Exists only for the offline-download flow — see the docstring
 * on `readBasemapTile` for why normal map viewing never calls this and reads
 * the archive directly in the browser instead.
 *
 * 404, not 204, when no archive is configured at all: an empty ocean tile is
 * an ordinary outcome worth caching quietly, but a deployment with no
 * `NUXT_PUBLIC_BASEMAP_PMTILES_URL` set (development, or a production
 * instance that has not been migrated off OpenFreeMap yet) has no offline
 * basemap capability at all, and the download flow needs to be able to tell
 * the two apart to decide whether to offer a basemap layer in the first place.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'A production basemap tile, for the offline-download flow only',
    description:
      'Reads one tile out of the configured PMTiles archive. Not used by normal map rendering, which reads the archive directly over HTTP range requests. 404 when no archive is configured; 204 for a genuinely empty tile.',
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

  const pmtilesUrl = useRuntimeConfig().public.basemap.pmtilesUrl

  if (!pmtilesUrl) {
    throw createError({
      statusCode: 404,
      message: 'No offline basemap is configured for this deployment.',
    })
  }

  const tileResult = await readBasemapTile(pmtilesUrl, tile)

  // Cached generously: the archive is a deploy-time asset that changes only
  // when someone re-runs the basemap import, unlike the contributed-data
  // tiles this route sits beside.
  setResponseHeader(event, 'cache-control', 'public, max-age=86400, stale-while-revalidate=604800')

  if (!tileResult) {
    setResponseStatus(event, 204)
    return null
  }

  setResponseHeader(event, 'content-type', tileResult.contentType)
  return tileResult.data
})
