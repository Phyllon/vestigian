import { describe, expect, it } from 'vitest'
import {
  cellsOfGrid,
  decodeSeenCells,
  encodeSeenCells,
  farthestSeenBySector,
  isSeenAt,
  seenGridFromCells,
  seenRuns,
  wedgeRing,
} from '../seen-grid'

const SHAPE = { columns: 360, binMetres: 100, binCount: 100 }

const blank = (): Uint8Array => new Uint8Array(SHAPE.columns * SHAPE.binCount)

const mark = (cells: Uint8Array, column: number, fromBin: number, toBin: number): void => {
  for (let bin = fromBin; bin < toBin; bin++) cells[column * SHAPE.binCount + bin] = 1
}

describe('packing the seen cells', () => {
  it('round-trips a pattern bit for bit, including a length that is not a multiple of eight', () => {
    const cells = new Uint8Array(13)
    ;[0, 3, 7, 8, 12].forEach((index) => (cells[index] = 1))
    expect([...decodeSeenCells(encodeSeenCells(cells), 13)]).toEqual([...cells])
  })

  it('is 6 kilobytes of base64 for a full ten-kilometre one-degree grid', () => {
    const cells = blank()
    cells.fill(1)
    expect(encodeSeenCells(cells)).toHaveLength(Math.ceil(Math.ceil(36_000 / 8) / 3) * 4)
  })

  it('carries its shape with it', () => {
    const cells = blank()
    mark(cells, 10, 5, 8)
    const grid = seenGridFromCells(cells, SHAPE)
    expect(grid).toMatchObject(SHAPE)
    expect([...cellsOfGrid(grid)]).toEqual([...cells])
  })
})

describe('runs of seen ground', () => {
  it('finds each run in each wedge, and none in an empty one', () => {
    const cells = blank()
    mark(cells, 0, 0, 2)
    mark(cells, 0, 10, 12)
    mark(cells, 90, 95, 100) // up to the very edge of the grid
    expect(seenRuns(cells, SHAPE)).toEqual([
      { column: 0, fromBin: 0, toBin: 2 },
      { column: 0, fromBin: 10, toBin: 12 },
      { column: 90, fromBin: 95, toBin: 100 },
    ])
  })
})

describe('asking about a place', () => {
  const cells = blank()
  mark(cells, 90, 20, 30) // east, 2.0–3.0 km

  it('reads the cell a bearing and distance fall in', () => {
    expect(isSeenAt(cells, SHAPE, { bearingDegrees: 90.4, distanceMetres: 2_500 })).toBe(true)
    expect(isSeenAt(cells, SHAPE, { bearingDegrees: 90.4, distanceMetres: 3_500 })).toBe(false)
    expect(isSeenAt(cells, SHAPE, { bearingDegrees: 91.2, distanceMetres: 2_500 })).toBe(false)
  })

  it('wraps a negative or over-full bearing', () => {
    const north = blank()
    mark(north, 359, 0, 5)
    expect(isSeenAt(north, SHAPE, { bearingDegrees: -0.5, distanceMetres: 300 })).toBe(true)
    expect(isSeenAt(north, SHAPE, { bearingDegrees: 359.5, distanceMetres: 300 })).toBe(true)
  })

  it('says no beyond the grid and at the tower itself', () => {
    expect(isSeenAt(cells, SHAPE, { bearingDegrees: 90, distanceMetres: 0 })).toBe(false)
    expect(isSeenAt(cells, SHAPE, { bearingDegrees: 90, distanceMetres: 10_000 })).toBe(false)
  })
})

describe('the farthest ground seen in each direction', () => {
  it('takes the outermost seen bin in each of the eight sectors, and 0 where none is', () => {
    const cells = blank()
    mark(cells, 0, 0, 3) // north: to 300 m
    mark(cells, 5, 40, 50) // still north: to 5.0 km — the farther wins
    mark(cells, 180, 0, 8) // south: to 800 m
    const farthest = farthestSeenBySector(cells, SHAPE)

    expect(farthest.n).toBe(5_000)
    expect(farthest.s).toBe(800)
    expect(farthest.e).toBe(0)
  })
})

describe('a run drawn on the ground', () => {
  it('is a closed ring that stays between its inner and outer distance', () => {
    const origin = { lon: 8.5, lat: 50.2 }
    const ring = wedgeRing(origin, { column: 90, fromBin: 10, toBin: 12 }, SHAPE)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring.length).toBeGreaterThan(4)
    // Due east: longitude grows with distance, latitude is about the tower's.
    const longitudes = ring.map((point) => point[0])
    expect(Math.min(...longitudes)).toBeGreaterThan(origin.lon + 0.014)
    expect(Math.max(...longitudes)).toBeLessThan(origin.lon + 0.02)
  })
})
