import sharp from 'sharp'
import type { TileCoordinate } from '#shared/types'
import { decodeTerrariumElevation } from '#shared/utils/spot'
import { readBasemapTile } from './basemap-pmtiles'

/**
 * The elevation under a coordinate, read from the same terrain tiles the
 * hillshade is drawn from — the production mirror (`terrain-z12-*.pmtiles`) or,
 * in development, Mapterhorn's own tiles. Copernicus GLO-30 underneath: a
 * *surface* model, so a town or a forest reads a few metres above bare ground.
 *
 * Read here, on the server, rather than in the browser: one tile is 50–150 KB
 * and a reader tapping marks on a phone should not pay that per tap, whereas
 * the answer is a handful of bytes and caches by coordinate. It also means the
 * reader's browser never contacts the tile host for this.
 */

/** The mirror stops at zoom 12; asking dev's template for the same zoom keeps the two agreeing. */
export const TERRAIN_ZOOM = 12

const MAPTERHORN_TEMPLATE = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'
const TERRAIN_FETCH_TIMEOUT_MS = 4000
/** A 512-pixel tile is 0.26 megapixels; this only refuses something that is not a terrain tile. */
const TERRAIN_MAX_PIXELS = 1024 * 1024
/** Web Mercator's own limit — past it the tile row formula has no answer. */
const MERCATOR_MAX_LATITUDE = 85.0511

export interface TerrainTilePosition {
  tile: TileCoordinate
  /** Where the point falls inside the tile, 0–1 from the top-left corner. */
  u: number
  v: number
}

export const locateInTerrainTile = (
  lon: number,
  lat: number,
  zoom: number,
): TerrainTilePosition => {
  const tileCount = 2 ** zoom
  const latitude =
    (Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat)) * Math.PI) / 180
  const column = ((lon + 180) / 360) * tileCount
  const row =
    ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * tileCount
  const x = Math.min(tileCount - 1, Math.max(0, Math.floor(column)))
  const y = Math.min(tileCount - 1, Math.max(0, Math.floor(row)))
  return { tile: { z: zoom, x, y }, u: column - x, v: row - y }
}

export interface RawTerrainTile {
  data: Uint8Array
  width: number
  height: number
  channels: number
}

/**
 * Bilinear between the four pixel centres around the point, so a value does not
 * step by a whole pixel (13 m at this latitude) as the coordinate crosses a
 * pixel boundary. Neighbours past the tile edge are clamped rather than read
 * from the next tile — an error of one pixel's slope at the very edge.
 */
export const sampleTerrain = (tile: RawTerrainTile, u: number, v: number): number => {
  const valueAt = (column: number, row: number): number => {
    const index = (row * tile.width + column) * tile.channels
    return decodeTerrariumElevation(tile.data[index]!, tile.data[index + 1]!, tile.data[index + 2]!)
  }
  const gx = u * tile.width - 0.5
  const gy = v * tile.height - 0.5
  const x0 = Math.max(0, Math.min(tile.width - 2, Math.floor(gx)))
  const y0 = Math.max(0, Math.min(tile.height - 2, Math.floor(gy)))
  const wx = Math.min(1, Math.max(0, gx - x0))
  const wy = Math.min(1, Math.max(0, gy - y0))
  return (
    valueAt(x0, y0) * (1 - wx) * (1 - wy) +
    valueAt(x0 + 1, y0) * wx * (1 - wy) +
    valueAt(x0, y0 + 1) * (1 - wx) * wy +
    valueAt(x0 + 1, y0 + 1) * wx * wy
  )
}

const isPmtilesUrl = (url: string): boolean =>
  url.startsWith('pmtiles://') || /\.pmtiles(?:\?|$)/.test(url)

const fetchTerrainTile = async (
  terrainUrl: string,
  tile: TileCoordinate,
): Promise<Buffer | null> => {
  if (isPmtilesUrl(terrainUrl)) {
    const read = await readBasemapTile(terrainUrl.replace(/^pmtiles:\/\//, ''), tile)
    return read?.data ?? null
  }

  const template = terrainUrl.length > 0 ? terrainUrl : MAPTERHORN_TEMPLATE
  const url = template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
  const response = await fetch(url, { signal: AbortSignal.timeout(TERRAIN_FETCH_TIMEOUT_MS) })
  if (!response.ok) return null
  return Buffer.from(await response.arrayBuffer())
}

export interface ElevationRequest {
  lon: number
  lat: number
  /** `public.basemap.terrainUrl`; empty means Mapterhorn's own tiles. */
  terrainUrl: string
}

/**
 * Metres to the nearest one, or `null` where there is no terrain tile — the
 * mirror covers 25°W–80°E, 12°N–66°N, and an ocean tile is a handful of bytes
 * of zero. Throws on a network or decode failure; the caller decides that is
 * "no answer" rather than "an error".
 */
export const readElevation = async (request: ElevationRequest): Promise<number | null> => {
  const { tile, u, v } = locateInTerrainTile(request.lon, request.lat, TERRAIN_ZOOM)
  const encoded = await fetchTerrainTile(request.terrainUrl, tile)
  if (!encoded) return null

  const { data, info } = await sharp(encoded, { limitInputPixels: TERRAIN_MAX_PIXELS })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return Math.round(
    sampleTerrain({ data, width: info.width, height: info.height, channels: info.channels }, u, v),
  )
}
