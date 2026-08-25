/**
 * Pre-renders the tiles that every visitor hits first.
 *
 * The one predictable slow moment in this application is the minutes after a
 * deploy or a data-version bump, when the Valkey cache is empty and the low
 * zoom tiles — the expensive clustered ones covering whole countries — are all
 * generated at once by real traffic. There are only a few hundred of them, so
 * warming them costs a few seconds and removes the spike entirely.
 *
 *   pnpm tiles:warm                       # local
 *   pnpm tiles:warm https://vestigia.org  # after deploying
 */

/** Zoom levels worth warming: everything the opening view can reach. */
const WARM_ZOOM_RANGE = { from: 2, to: 8 }

/**
 * Europe and the Mediterranean — the extent of the data. Warming the whole
 * world would render thousands of empty ocean tiles for nothing.
 */
const DATA_BOUNDS = { west: -12, south: 30, east: 45, north: 60 }

/** Parallelism. High enough to be quick, low enough not to saturate Postgres. */
const CONCURRENCY = 6

interface TileRef {
  z: number
  x: number
  y: number
}

const lonToTileX = (lon: number, zoom: number): number =>
  Math.floor(((lon + 180) / 360) * 2 ** zoom)

const latToTileY = (lat: number, zoom: number): number => {
  const radians = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom,
  )
}

const enumerateTiles = (): TileRef[] => {
  const tiles: TileRef[] = []

  for (let z = WARM_ZOOM_RANGE.from; z <= WARM_ZOOM_RANGE.to; z += 1) {
    const minX = lonToTileX(DATA_BOUNDS.west, z)
    const maxX = lonToTileX(DATA_BOUNDS.east, z)
    // Tile Y runs north to south, so the northern bound produces the lower index.
    const minY = latToTileY(DATA_BOUNDS.north, z)
    const maxY = latToTileY(DATA_BOUNDS.south, z)

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        tiles.push({ z, x, y })
      }
    }
  }

  return tiles
}

const warmTile = async (baseUrl: string, tile: TileRef): Promise<boolean> => {
  const response = await fetch(`${baseUrl}/api/tiles/${tile.z}/${tile.x}/${tile.y}.mvt`)
  return response.ok || response.status === 204
}

const main = async (): Promise<void> => {
  const baseUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')
  const tiles = enumerateTiles()

  console.log(`Warming ${tiles.length} tiles on ${baseUrl}\n`)
  const startedAt = Date.now()

  let completed = 0
  let failed = 0

  // A simple worker pool: each worker pulls the next tile until the list runs out.
  const cursor = { index: 0 }

  const worker = async (): Promise<void> => {
    while (cursor.index < tiles.length) {
      const tile = tiles[cursor.index++]!
      try {
        if (!(await warmTile(baseUrl, tile))) failed += 1
      } catch {
        failed += 1
      }
      completed += 1
      if (completed % 100 === 0) console.log(`· ${completed}/${tiles.length}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\nWarmed ${completed - failed} tiles in ${seconds}s (${failed} failed).`)
}

await main()

// This file has no imports, so without an export TypeScript treats it as a
// script rather than a module and rejects the top-level await above.
export {}
