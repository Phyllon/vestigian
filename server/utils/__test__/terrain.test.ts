import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chooseTerrainZoom,
  loadTerrainField,
  locateInTerrainTile,
  sampleTerrain,
  TERRAIN_FIELD_MAX_TILES,
} from '../terrain'
import type { RawTerrainTile } from '../terrain'

describe('locating a coordinate in a terrain tile', () => {
  it('finds the tile the production archive holds for Frauenfeld', () => {
    // Read straight out of terrain-z12-20261003.pmtiles: this is the tile that decoded to ~418 m.
    const { tile, u, v } = locateInTerrainTile(8.8985, 47.5565, 12)
    expect(tile).toEqual({ z: 12, x: 2149, y: 1431 })
    expect(u).toBeGreaterThan(0)
    expect(u).toBeLessThan(1)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  it('puts the date line and the poles on a real tile rather than past the edge', () => {
    expect(locateInTerrainTile(180, 0, 12).tile.x).toBe(4095)
    expect(locateInTerrainTile(-180, 0, 12).tile.x).toBe(0)
    expect(locateInTerrainTile(0, 90, 12).tile.y).toBe(0)
    expect(locateInTerrainTile(0, -90, 12).tile.y).toBe(4095)
  })
})

describe('sampling a terrain tile', () => {
  /** A tile whose every pixel decodes to the same height: R=128 is 0 m, G is metres above it. */
  const flat = (metres: number): RawTerrainTile => {
    const data = new Uint8Array(4 * 4 * 3)
    for (let pixel = 0; pixel < 16; pixel++) {
      data[pixel * 3] = 128
      data[pixel * 3 + 1] = metres
    }
    return { data, width: 4, height: 4, channels: 3 }
  }

  it('reads a flat tile as that height wherever it is sampled', () => {
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.5],
      [0.999, 0.999],
    ] as const) {
      expect(sampleTerrain(flat(200), u, v)).toBeCloseTo(200, 6)
    }
  })

  it('interpolates between pixel centres rather than stepping by a whole pixel', () => {
    // Columns rise 0, 100, 200, 300 m left to right.
    const data = new Uint8Array(4 * 4 * 3)
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        const index = (row * 4 + column) * 3
        data[index] = 128
        data[index + 1] = column * 100
      }
    }
    const ramp: RawTerrainTile = { data, width: 4, height: 4, channels: 3 }
    // u = 0.375 is the centre of pixel 1 (100 m); u = 0.5 is halfway to pixel 2.
    expect(sampleTerrain(ramp, 0.375, 0.5)).toBeCloseTo(100, 6)
    expect(sampleTerrain(ramp, 0.5, 0.5)).toBeCloseTo(150, 6)
  })

  it('clamps at the tile edge instead of reading outside it', () => {
    expect(sampleTerrain(flat(50), 0, 0)).toBeCloseTo(50, 6)
    expect(sampleTerrain(flat(50), 1, 1)).toBeCloseTo(50, 6)
  })

  it('reads below sea level', () => {
    // R=127, G=47 is -209 m (the Dead Sea shore).
    const data = new Uint8Array(4 * 4 * 3)
    for (let pixel = 0; pixel < 16; pixel++) {
      data[pixel * 3] = 127
      data[pixel * 3 + 1] = 47
    }
    expect(sampleTerrain({ data, width: 4, height: 4, channels: 3 }, 0.5, 0.5)).toBeCloseTo(-209, 6)
  })
})

describe('a terrain field', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A 4 × 4 PNG in the terrarium encoding whose every pixel decodes to `metres`. */
  const flatTile = async (metres: number): Promise<Buffer> => {
    const pixels = Buffer.alloc(4 * 4 * 3)
    for (let pixel = 0; pixel < 16; pixel++) {
      pixels[pixel * 3] = 128 + Math.floor(metres / 256)
      pixels[pixel * 3 + 1] = Math.floor(metres % 256)
      pixels[pixel * 3 + 2] = 0
    }
    return sharp(pixels, { raw: { width: 4, height: 4, channels: 3 } })
      .png()
      .toBuffer()
  }

  const stubTiles = (heights: Record<string, number>) => {
    const requested: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      const match = /\/(\d+)\/(\d+)\/(\d+)\.webp$/.exec(url)
      const key = match ? `${match[2]}/${match[3]}` : ''
      requested.push(key)
      const metres = heights[key]
      if (metres === undefined) return new Response(null, { status: 404 })
      const body = await flatTile(metres)
      return new Response(new Uint8Array(body), { status: 200 })
    })
    return requested
  }

  /** The longitude of the western edge of a z12 tile column. */
  const tileWestLongitude = (x: number): number => (x / 4096) * 360 - 180

  it('reads across the seam between two tiles without stepping', async () => {
    // Two neighbouring tiles at 100 m and 200 m: on the seam the answer is the
    // middle of the two, not whichever tile the coordinate happens to be filed in.
    const { tile } = locateInTerrainTile(11.1, 48.9, 12)
    stubTiles({ [`${tile.x}/${tile.y}`]: 100, [`${tile.x + 1}/${tile.y}`]: 200 })

    const latitude = 48.9
    const seam = tileWestLongitude(tile.x + 1)
    const field = await loadTerrainField({
      area: {
        bounds: {
          west: seam - 0.02,
          east: seam + 0.02,
          south: latitude - 0.01,
          north: latitude + 0.01,
        },
      },
      terrainUrl: 'https://tiles.example.test/{z}/{x}/{y}.webp',
      zoom: 12,
    })

    expect(field.tileCount).toBeGreaterThanOrEqual(2)
    expect(field.failedTileCount).toBe(0)
    expect(field.elevationAt(seam, latitude)).toBeCloseTo(150, 1)
    expect(field.elevationAt(seam - 0.03, latitude)).toBeCloseTo(100, 1)
    expect(field.elevationAt(seam + 0.03, latitude)).toBeCloseTo(200, 1)
  })

  it('answers null where no tile covers the coordinate, rather than a zero', async () => {
    const { tile } = locateInTerrainTile(2.3, 48.85, 12)
    stubTiles({ [`${tile.x}/${tile.y}`]: 80 })

    const field = await loadTerrainField({
      area: { bounds: { west: 2.29, east: 2.31, south: 48.84, north: 48.86 } },
      terrainUrl: 'https://tiles.example.test/{z}/{x}/{y}.webp',
      zoom: 12,
    })

    expect(field.elevationAt(2.3, 48.85)).toBeCloseTo(80, 1)
    // Far outside everything that was loaded.
    expect(field.elevationAt(9, 40)).toBeNull()
  })

  it('counts a tile that could not be read instead of failing the whole field', async () => {
    const { tile } = locateInTerrainTile(6.6, 49.7, 12)
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes(`/${tile.x}/${tile.y}.`)) return new Response(null, { status: 500 })
      return new Response(new Uint8Array(await flatTile(10)), { status: 200 })
    })

    const west = tileWestLongitude(tile.x) - 0.01
    const east = tileWestLongitude(tile.x + 1) + 0.01
    const field = await loadTerrainField({
      area: { bounds: { west, east, south: 49.69, north: 49.71 } },
      terrainUrl: 'https://tiles.example.test/{z}/{x}/{y}.webp',
      zoom: 12,
    })

    // A 500 is not a tile: the server's answer for "no data" is a 404, a 500 is a fault.
    expect(field.tileCount).toBeGreaterThan(1)
    expect(field.elevationAt(tileWestLongitude(tile.x) + 0.001, 49.7)).toBeNull()
  })

  it('moves to a coarser zoom rather than loading a province of tiles for one long line', () => {
    const wide = { west: 0, east: 10, south: 40, north: 50 }
    const zoom = chooseTerrainZoom({ bounds: wide })
    expect(zoom).toBeLessThan(12)

    const small = { west: 8.5, east: 8.52, south: 50.2, north: 50.21 }
    expect(chooseTerrainZoom({ bounds: small })).toBe(12)
    expect(TERRAIN_FIELD_MAX_TILES).toBeGreaterThan(0)
  })

  it('loads only the tiles a list of points touches, not the box around them', () => {
    // Two points on opposite corners of a degree-wide box.
    const positions = [
      { lon: 8.0, lat: 50.0 },
      { lon: 9.0, lat: 51.0 },
    ]
    const withPositions = chooseTerrainZoom({ positions })
    const withBounds = chooseTerrainZoom({ bounds: { west: 8, east: 9, south: 50, north: 51 } })
    // Two points need a handful of tiles at the finest zoom; the box needs thousands.
    expect(withPositions).toBe(12)
    expect(withBounds).toBeLessThan(12)
  })
})
