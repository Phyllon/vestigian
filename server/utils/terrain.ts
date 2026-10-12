import sharp from 'sharp'
import type { BoundingBox, TileCoordinate } from '#shared/types'
import { decodeTerrariumElevation } from '../../shared/utils/spot'
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

/**
 * A rectangle of terrain, decoded once and read many times.
 *
 * `readElevation` answers one coordinate and throws the tile away; a line of
 * sight or a profile asks for hundreds of thousands and wants the tiles kept.
 * The caller names a bounding box, every tile under it is fetched and decoded up
 * front (the part that waits on I/O), and `elevationAt` is then plain arithmetic
 * over memory — which is what lets the geometry live in `shared/` as pure
 * functions with no knowledge of tiles.
 *
 * Bilinear across tile edges: a ray that crosses from one tile into the next does
 * not step, and a point on a seam is not read from one side only.
 */
export interface TerrainFieldRequest {
  /**
   * What will be read: a box (every tile under it is loaded), or the exact
   * points (only the tiles they touch — a long diagonal road does not pull in a
   * province's worth of tiles it never crosses).
   */
  area: { bounds: BoundingBox } | { positions: readonly { lon: number; lat: number }[] }
  /** `public.basemap.terrainUrl`; empty means Mapterhorn's own tiles. */
  terrainUrl: string
  /** Defaults to the finest zoom that keeps the tile count in bounds. */
  zoom?: number
}

export interface TerrainField {
  zoom: number
  /** Tiles the box covers. */
  tileCount: number
  /** Tiles that could not be fetched or decoded — an ocean tile is empty, not missing. */
  failedTileCount: number
  /** Metres above sea level, or `null` where no tile covers the coordinate. */
  elevationAt: (lon: number, lat: number) => number | null
}

interface DecodedTile {
  elevations: Float32Array
  width: number
  height: number
}

/**
 * How many decoded tiles stay in memory between requests: 512 × 512 × 4 bytes is
 * 1 MiB each, and the towers of one frontier sector share most of theirs, so a
 * short memory is the one that earns its keep. Bounded because a long profile
 * (a road across a province) would otherwise walk it up without limit.
 */
const DECODED_TILE_LIMIT = 48
const TILE_FETCH_CONCURRENCY = 6

/** More than this and a coarser zoom is used instead: a 700 km road is not drawn at 12 m. */
export const TERRAIN_FIELD_MAX_TILES = 120

const decodedTiles = new Map<string, Promise<DecodedTile | null>>()

const decodeTerrainTile = async (encoded: Buffer): Promise<DecodedTile> => {
  const { data, info } = await sharp(encoded, { limitInputPixels: TERRAIN_MAX_PIXELS })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const elevations = new Float32Array(info.width * info.height)
  for (let pixel = 0; pixel < elevations.length; pixel++) {
    const index = pixel * info.channels
    elevations[pixel] = decodeTerrariumElevation(data[index]!, data[index + 1]!, data[index + 2]!)
  }
  return { elevations, width: info.width, height: info.height }
}

const loadDecodedTile = (terrainUrl: string, tile: TileCoordinate): Promise<DecodedTile | null> => {
  const key = `${terrainUrl}#${tile.z}/${tile.x}/${tile.y}`
  const cached = decodedTiles.get(key)
  if (cached) {
    // Re-insert so the oldest entry is the least recently used.
    decodedTiles.delete(key)
    decodedTiles.set(key, cached)
    return cached
  }

  const pending = (async (): Promise<DecodedTile | null> => {
    const encoded = await fetchTerrainTile(terrainUrl, tile)
    return encoded ? decodeTerrainTile(encoded) : null
  })()
  decodedTiles.set(key, pending)
  pending.catch(() => decodedTiles.delete(key))

  while (decodedTiles.size > DECODED_TILE_LIMIT) {
    const oldest = decodedTiles.keys().next().value
    if (oldest === undefined) break
    decodedTiles.delete(oldest)
  }
  return pending
}

/** Mapterhorn's terrarium tiles are 512 pixels square (seen on every tile fetched). */
const TERRAIN_TILE_PIXELS = 512

const tileKey = (x: number, y: number): string => `${x}/${y}`

/**
 * Every tile a bilinear read at each position can touch — the four pixels around
 * it, which straddle a tile edge for the one position in 512 that sits on one.
 */
const tilesForPositions = (
  positions: readonly { lon: number; lat: number }[],
  zoom: number,
): Map<string, TileCoordinate> => {
  const worldPixels = 2 ** zoom * TERRAIN_TILE_PIXELS
  const wanted = new Map<string, TileCoordinate>()

  for (const { lon, lat } of positions) {
    const clamped = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat))
    const radians = (clamped * Math.PI) / 180
    const column = ((lon + 180) / 360) * worldPixels
    const row =
      ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * worldPixels
    for (const columnOffset of [-1, 1]) {
      for (const rowOffset of [-1, 1]) {
        const x = Math.floor((column + columnOffset) / TERRAIN_TILE_PIXELS)
        const y = Math.floor((row + rowOffset) / TERRAIN_TILE_PIXELS)
        wanted.set(tileKey(x, y), { z: zoom, x, y })
      }
    }
  }
  return wanted
}

const tilesForBounds = (bounds: BoundingBox, zoom: number): Map<string, TileCoordinate> => {
  const northWest = locateInTerrainTile(bounds.west, bounds.north, zoom).tile
  const southEast = locateInTerrainTile(bounds.east, bounds.south, zoom).tile
  const wanted = new Map<string, TileCoordinate>()
  for (let y = northWest.y; y <= southEast.y; y++) {
    for (let x = northWest.x; x <= southEast.x; x++) wanted.set(tileKey(x, y), { z: zoom, x, y })
  }
  return wanted
}

const tilesForArea = (
  area: TerrainFieldRequest['area'],
  zoom: number,
): Map<string, TileCoordinate> =>
  'bounds' in area ? tilesForBounds(area.bounds, zoom) : tilesForPositions(area.positions, zoom)

/**
 * The finest zoom, not above `preferred`, at which the area takes no more than
 * {@link TERRAIN_FIELD_MAX_TILES} tiles.
 */
export const chooseTerrainZoom = (
  area: TerrainFieldRequest['area'],
  preferred: number = TERRAIN_ZOOM,
): number => {
  for (let zoom = preferred; zoom > 4; zoom--) {
    if (tilesForArea(area, zoom).size <= TERRAIN_FIELD_MAX_TILES) return zoom
  }
  return 4
}

export const loadTerrainField = async (request: TerrainFieldRequest): Promise<TerrainField> => {
  const zoom = request.zoom ?? chooseTerrainZoom(request.area)
  const wanted = [...tilesForArea(request.area, zoom).values()]

  const tiles = new Map<string, DecodedTile>()
  let failedTileCount = 0

  for (let offset = 0; offset < wanted.length; offset += TILE_FETCH_CONCURRENCY) {
    const batch = wanted.slice(offset, offset + TILE_FETCH_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((tile) => loadDecodedTile(request.terrainUrl, tile)),
    )
    results.forEach((result, index) => {
      const tile = batch[index]!
      if (result.status === 'rejected') {
        failedTileCount++
        return
      }
      if (result.value) tiles.set(tileKey(tile.x, tile.y), result.value)
    })
  }

  const worldTiles = 2 ** zoom
  let lastKey = ''
  let lastTile: DecodedTile | undefined

  const tileAt = (tileX: number, tileY: number): DecodedTile | undefined => {
    const key = tileKey(tileX, tileY)
    if (key === lastKey) return lastTile
    lastKey = key
    lastTile = tiles.get(key)
    return lastTile
  }

  const sampleSize = [...tiles.values()][0]

  /** One pixel by its global column and row; NaN where its tile was not loaded. */
  const pixel = (column: number, row: number): number => {
    if (!sampleSize) return Number.NaN
    const { width, height } = sampleSize
    const tileX = Math.floor(column / width)
    const tileY = Math.floor(row / height)
    const tile = tileAt(tileX, tileY)
    if (!tile) return Number.NaN
    return tile.elevations[(row - tileY * height) * tile.width + (column - tileX * width)]!
  }

  const elevationAt = (lon: number, lat: number): number | null => {
    if (!sampleSize) return null
    const { width, height } = sampleSize
    const clampedLatitude = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat))
    const latitude = (clampedLatitude * Math.PI) / 180
    const column = ((lon + 180) / 360) * worldTiles * width
    const row =
      ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) *
      worldTiles *
      height

    const gx = column - 0.5
    const gy = row - 0.5
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const wx = gx - x0
    const wy = gy - y0

    const topLeft = pixel(x0, y0)
    const topRight = pixel(x0 + 1, y0)
    const bottomLeft = pixel(x0, y0 + 1)
    const bottomRight = pixel(x0 + 1, y0 + 1)
    if (
      Number.isNaN(topLeft) ||
      Number.isNaN(topRight) ||
      Number.isNaN(bottomLeft) ||
      Number.isNaN(bottomRight)
    ) {
      return null
    }

    return (
      topLeft * (1 - wx) * (1 - wy) +
      topRight * wx * (1 - wy) +
      bottomLeft * (1 - wx) * wy +
      bottomRight * wx * wy
    )
  }

  return { zoom, tileCount: wanted.length, failedTileCount, elevationAt }
}
