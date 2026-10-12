import { describe, expect, it } from 'vitest'
import {
  addTowerCoverage,
  componentsOf,
  contiguousRuns,
  foldTwinTowers,
  makeCoverageGrid,
  overlookedBy,
  readChain,
  rectanglesAtLeast,
  rectanglesToWkt,
  spanningEdges,
  unwatchedStretches,
} from '../sector-watch'

const at = (id: number, lon: number, lat = 49) => ({ id, position: { lon, lat } })

describe('twin records', () => {
  it('folds a timber and a stone phase eighteen metres apart into one post', () => {
    // 0.00025° of longitude at 49° is about 18 m.
    const { kept, foldedCount } = foldTwinTowers([at(1, 8.0), at(2, 8.00025), at(3, 8.02)], 60)
    expect(kept.map((tower) => tower.id)).toEqual([1, 3])
    expect(foldedCount).toBe(1)
  })

  it('keeps two towers a few hundred metres apart', () => {
    const { kept, foldedCount } = foldTwinTowers([at(1, 8.0), at(2, 8.005)], 60)
    expect(kept).toHaveLength(2)
    expect(foldedCount).toBe(0)
  })

  it('keeps the lower id when the two arrive in either order', () => {
    const { kept } = foldTwinTowers([at(9, 8.00025), at(4, 8.0)], 60)
    expect(kept.map((tower) => tower.id)).toEqual([4])
  })
})

describe('the line of towers', () => {
  // Five towers a kilometre apart on one parallel, then a sixth 20 km further.
  const kilometre = 0.0137 // degrees of longitude at 49°
  const line = [0, 1, 2, 3, 4].map((step) => ({ lon: 8 + step * kilometre, lat: 49 }))
  const far = { lon: 8 + 24 * kilometre, lat: 49 }

  it('joins each tower to its neighbour along, and calls a distant one a gap in the records', () => {
    const { edges, gapEdges } = spanningEdges([...line, far], 6_000)
    expect(edges).toHaveLength(4)
    edges.forEach((edge) => expect(edge.lengthMetres).toBeGreaterThan(900))
    edges.forEach((edge) => expect(edge.lengthMetres).toBeLessThan(1_100))
    expect(gapEdges).toHaveLength(1)
    expect(gapEdges[0]!.lengthMetres).toBeGreaterThan(15_000)
  })

  it('gives nothing for fewer than two towers', () => {
    expect(spanningEdges([line[0]!], 6_000)).toEqual({ edges: [], gapEdges: [] })
  })

  it('groups towers by the clear links between them', () => {
    // 0–1 and 1–2 clear; 3–4 clear; nothing joins the two groups.
    const components = componentsOf(5, [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ])
    expect(components[0]).toBe(components[2])
    expect(components[3]).toBe(components[4])
    expect(components[0]).not.toBe(components[3])
  })

  it('reads a break where no chain of clear links joins two neighbours', () => {
    const { edges } = spanningEdges(line, 6_000)
    const components = componentsOf(5, [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ])
    const chain = readChain(edges, components)

    expect(chain.breaks).toHaveLength(1)
    expect(chain.coveredMetres / chain.totalMetres).toBeCloseTo(0.75, 1)
  })

  it('is not a break where a longer clear link bridges a blocked neighbour', () => {
    const { edges } = spanningEdges(line, 6_000)
    // 1–2 blocked, but 0–2 and 1–3... : 0 sees 2 over tower 1, 2 sees 3, 3 sees 4.
    const components = componentsOf(5, [
      { from: 0, to: 2 },
      { from: 0, to: 1 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ])
    expect(readChain(edges, components).breaks).toHaveLength(0)
  })

  it('covers nothing when nothing is clear', () => {
    const { edges } = spanningEdges(line, 6_000)
    const chain = readChain(edges, componentsOf(5, []))
    expect(chain.coveredMetres).toBe(0)
    expect(chain.breaks).toHaveLength(4)
  })
})

describe('ground overlooked by the towers', () => {
  const SHAPE = { columns: 360, binMetres: 100, binCount: 100 }
  const bounds = { west: 7.9, east: 8.1, south: 48.95, north: 49.05 }

  /** A tower that sees only the wedge due east, from 1 to 3 km. */
  const eastwardTower = (lon: number) => {
    const cells = new Uint8Array(SHAPE.columns * SHAPE.binCount)
    for (let column = 80; column < 100; column++) {
      for (let bin = 10; bin < 30; bin++) cells[column * SHAPE.binCount + bin] = 1
    }
    return { position: { lon, lat: 49 }, cells, shape: SHAPE }
  }

  it('counts the cells a tower sees and none of those it does not', () => {
    const grid = makeCoverageGrid(bounds, 200)
    const counts = new Uint8Array(grid.columns * grid.rows)
    addTowerCoverage(grid, counts, eastwardTower(8.0))

    // 2 km east of the tower, on its bearing: seen.
    expect(overlookedBy(grid, counts, { lon: 8.0 + 0.0275, lat: 49 })).toBe(1)
    // 2 km west: not.
    expect(overlookedBy(grid, counts, { lon: 8.0 - 0.0275, lat: 49 })).toBe(0)
    // 500 m east: inside the first kilometre the cells do not cover.
    expect(overlookedBy(grid, counts, { lon: 8.0 + 0.007, lat: 49 })).toBe(0)
    // Outside the grid altogether.
    expect(overlookedBy(grid, counts, { lon: 9, lat: 49 })).toBe(0)
  })

  it('adds the towers up', () => {
    const grid = makeCoverageGrid(bounds, 200)
    const counts = new Uint8Array(grid.columns * grid.rows)
    addTowerCoverage(grid, counts, eastwardTower(8.0))
    addTowerCoverage(grid, counts, eastwardTower(8.003))
    // 2.1 km east of the first tower is 1.9 km east of the second: both see it.
    expect(overlookedBy(grid, counts, { lon: 8.0 + 0.029, lat: 49 })).toBe(2)
  })

  it('turns counts into merged rectangles, a filled block being one', () => {
    const grid = makeCoverageGrid({ west: 0, east: 0.01, south: 0, north: 0.01 }, 200)
    const counts = new Uint8Array(grid.columns * grid.rows)
    // A solid 3 × 2 block.
    for (let row = 1; row <= 2; row++)
      for (let column = 1; column <= 3; column++) counts[row * grid.columns + column] = 3
    // A lone cell elsewhere.
    counts[0] = 1

    const rectangles = rectanglesAtLeast(grid, counts, 1)
    expect(rectangles).toHaveLength(2)

    const block = rectangles.find(
      (rectangle) => rectangle.east - rectangle.west > grid.cellLongitude * 2,
    )!
    expect(block.east - block.west).toBeCloseTo(grid.cellLongitude * 3, 9)
    expect(block.north - block.south).toBeCloseTo(grid.cellLatitude * 2, 9)

    expect(rectanglesAtLeast(grid, counts, 3)).toHaveLength(1)
    expect(rectanglesAtLeast(grid, counts, 4)).toHaveLength(0)
  })

  it('writes the rectangles as a MultiPolygon, or says there are none', () => {
    expect(rectanglesToWkt([])).toBe('MULTIPOLYGON EMPTY')
    const wkt = rectanglesToWkt([{ west: 1, south: 2, east: 3, north: 4 }])
    expect(wkt).toBe('MULTIPOLYGON(((1 2,3 2,3 4,1 4,1 2)))')
  })
})

describe('runs along a line made of parts', () => {
  it('finds each run of true flags', () => {
    expect(contiguousRuns([false, true, true, false, true], [])).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 5 },
    ])
  })

  it('splits a run at the seam between two parts, so it is not one chord across both', () => {
    // Samples 0–3 are one part, 4–7 the next; all within reach.
    expect(contiguousRuns([true, true, true, true, true, true, true, true], [4])).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
    ])
  })

  it('has no runs where nothing is in reach', () => {
    expect(contiguousRuns([false, false], [])).toEqual([])
  })
})

describe('stretches of the line nobody watches', () => {
  it('finds the unwatched runs and drops the ones shorter than noise', () => {
    const samples = [
      [0, true],
      [100, false],
      [200, false],
      [300, false],
      [400, true],
      [500, false],
      [600, true],
      [700, false],
      [800, false],
    ].map(([distanceMetres, isWatched]) => ({
      distanceMetres: distanceMetres as number,
      isWatched: isWatched as boolean,
    }))

    expect(unwatchedStretches(samples, 150)).toEqual(
      [
        { fromMetres: 100, toMetres: 400 },
        { fromMetres: 700, toMetres: 800 },
      ].filter((stretch) => stretch.toMetres - stretch.fromMetres >= 150),
    )
    expect(unwatchedStretches(samples, 50)).toHaveLength(3)
  })

  it('is empty when everything is watched', () => {
    expect(
      unwatchedStretches(
        [
          { distanceMetres: 0, isWatched: true },
          { distanceMetres: 100, isWatched: true },
        ],
        0,
      ),
    ).toEqual([])
  })
})
