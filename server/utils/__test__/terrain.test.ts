import { describe, expect, it } from 'vitest'
import { locateInTerrainTile, sampleTerrain } from '../terrain'
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
