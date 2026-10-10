import { PMTiles, TileType } from 'pmtiles'
import type { TileCoordinate } from '#shared/types'

/**
 * Reads individual tiles out of the production PMTiles basemap archive,
 * server-side — the piece that makes "download this area for offline use"
 * possible in production, where the live map never talks to this server for
 * basemap tiles at all.
 *
 * Normal viewing bypasses this entirely: `useBasemapStyle` registers the
 * `pmtiles://` MapLibre protocol and the browser reads the archive directly
 * from Bunny/R2 over HTTP range requests. That is fast and correct for
 * rendering, and wrong for offline caching — a Service Worker cannot cache
 * "some byte ranges of one large file" the way it caches a URL, and the
 * archive for a useful area is commonly hundreds of megabytes to gigabytes
 * (see CLAUDE.md's basemap section), far more than a bounded "download this
 * area" should cost. This route exists so the *download* flow gets one
 * ordinary, cacheable HTTP response per tile — exactly like the other three
 * tile families — while normal map panning keeps using the range-read path
 * and never touches it.
 *
 * One `PMTiles` client per archive URL, reused across requests: it keeps its
 * own directory cache (`SharedPromiseCache`, the library's default), so
 * reusing the instance is what makes a second tile in the same directory
 * branch cost one range read instead of the two or three a cold client needs.
 * A map rather than one slot, because a second archive is read through here
 * too (the terrain mirror, for a spot's elevation) and a single slot would
 * have the two evicting each other's directory cache on every alternation.
 */
const clients = new Map<string, PMTiles>()

const resolveClient = (url: string): PMTiles => {
  let pmtiles = clients.get(url)
  if (!pmtiles) {
    pmtiles = new PMTiles(url)
    clients.set(url, pmtiles)
  }
  return pmtiles
}

const CONTENT_TYPE_BY_TILE_TYPE: Partial<Record<TileType, string>> = {
  [TileType.Mvt]: 'application/vnd.mapbox-vector-tile',
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
  [TileType.Webp]: 'image/webp',
  [TileType.Avif]: 'image/avif',
}

export interface BasemapTile {
  data: Buffer
  contentType: string
}

/**
 * `undefined` covers three cases the caller cannot tell apart and does not
 * need to: no archive is configured, the coordinate is outside the archive's
 * own zoom range, or the tile is genuinely empty (open ocean, most of the
 * planet). All three answer the same way a missing tile does everywhere else
 * in this app — 204, not an error.
 */
export const readBasemapTile = async (
  pmtilesUrl: string,
  tile: TileCoordinate,
): Promise<BasemapTile | undefined> => {
  if (!pmtilesUrl) return undefined

  const pmtiles = resolveClient(pmtilesUrl)
  const header = await pmtiles.getHeader()
  const result = await pmtiles.getZxy(tile.z, tile.x, tile.y)
  if (!result) return undefined

  return {
    data: Buffer.from(result.data),
    contentType:
      CONTENT_TYPE_BY_TILE_TYPE[header.tileType as TileType] ?? 'application/octet-stream',
  }
}
