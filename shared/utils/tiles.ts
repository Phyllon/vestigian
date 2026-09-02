import { MAX_ZOOM, MIN_ZOOM } from './tile-limits'
import type { BoundingBox, TileCoordinate } from '#shared/types'

/**
 * Web Mercator tile math shared between the server (which needs it to sample
 * real tile sizes for an offline-area estimate) and the client (which needs
 * the same list to actually fetch and cache those tiles). Kept in one place so
 * an offline download and the estimate that preceded it are counting the same
 * tiles — two independent implementations of "which tiles cover this bbox"
 * agreeing by coincidence is exactly the kind of drift `evaluateTrust` and
 * `evaluateMilestones` were already written to avoid elsewhere in this project.
 */

const longitudeToColumn = (lon: number, zoom: number): number =>
  Math.floor(((lon + 180) / 360) * 2 ** zoom)

const latitudeToRow = (lat: number, zoom: number): number => {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat))
  const radians = (clamped * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom,
  )
}

/**
 * Safety ceiling on a single enumeration. Without one, a bbox spanning the
 * whole configured import extent at a high max zoom would try to build an
 * array with tens of millions of entries before anything downstream — quota
 * check, confirmation dialog — gets a chance to refuse it.
 */
export const MAX_ENUMERATED_TILES = 20_000

export class TileCountExceededError extends Error {
  constructor(public readonly count: number) {
    super(
      `${count} tiles requested, more than the ${MAX_ENUMERATED_TILES} this app will enumerate at once. Shrink the area or the maximum zoom.`,
    )
    this.name = 'TileCountExceededError'
  }
}

/**
 * Every tile coordinate needed to cover `bbox` from `minZoom` to `maxZoom`
 * inclusive, ordered low zoom to high — so a cancelled or interrupted download
 * has already secured the overview levels, which are the ones worth having
 * even alone.
 *
 * Throws rather than silently truncating: a caller that asked for 4 million
 * tiles has a bbox or a max zoom that is wrong, and a partial, uncommunicated
 * download would be a worse outcome than a clear refusal.
 */
export const enumerateTiles = (
  bbox: BoundingBox,
  minZoom: number,
  maxZoom: number,
): TileCoordinate[] => {
  const clampedMin = Math.max(MIN_ZOOM, Math.min(minZoom, maxZoom))
  const clampedMax = Math.min(MAX_ZOOM, Math.max(minZoom, maxZoom))

  const tiles: TileCoordinate[] = []

  for (let z = clampedMin; z <= clampedMax; z++) {
    const x0 = longitudeToColumn(bbox.west, z)
    const x1 = longitudeToColumn(bbox.east, z)
    // North is the smaller row number in tile space (rows increase southward).
    const y0 = latitudeToRow(bbox.north, z)
    const y1 = latitudeToRow(bbox.south, z)

    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        tiles.push({ z, x, y })
        if (tiles.length > MAX_ENUMERATED_TILES) throw new TileCountExceededError(tiles.length)
      }
    }
  }

  return tiles
}

/** An evenly-spaced subset, for measuring real sizes without fetching every tile. */
export const sampleTiles = (tiles: TileCoordinate[], sampleSize: number): TileCoordinate[] => {
  if (tiles.length <= sampleSize) return tiles
  const step = tiles.length / sampleSize
  const sample: TileCoordinate[] = []
  for (let i = 0; i < sampleSize; i++) {
    const tile = tiles[Math.floor(i * step)]
    if (tile) sample.push(tile)
  }
  return sample
}
