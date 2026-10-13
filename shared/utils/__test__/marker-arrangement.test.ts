import { describe, expect, it } from 'vitest'
import {
  MIN_SCALE,
  RING_MEMBER_LIMIT,
  arrangeMarkers,
  type ArrangedMarker,
  type ArrangementMarker,
} from '../marker-arrangement'

const CELL = 30

const arrange = (markers: ArrangementMarker[]): ArrangedMarker[] =>
  arrangeMarkers(markers, { cellSize: CELL })

/** `count` markers on one spot, as records sharing a coordinate do. */
const stacked = (count: number, at = { x: 400, y: 300 }, firstId = 1): ArrangementMarker[] =>
  Array.from({ length: count }, (_, index) => ({ id: firstId + index, ...at }))

const smallestGap = (arranged: ArrangedMarker[]): number => {
  let gap = Infinity
  arranged.forEach((first, index) => {
    arranged.slice(index + 1).forEach((second) => {
      gap = Math.min(gap, Math.hypot(first.x - second.x, first.y - second.y))
    })
  })
  return gap
}

describe('which markers are moved', () => {
  it('returns nothing when no two markers overlap', () => {
    const apart = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 60, y: 0 },
      { id: 3, x: 0, y: 90 },
    ]
    expect(arrange(apart)).toEqual([])
  })

  it('returns nothing for a single marker or none', () => {
    expect(arrange([])).toEqual([])
    expect(arrange([{ id: 1, x: 5, y: 5 }])).toEqual([])
  })

  it('leaves a clear marker out of the result while arranging its neighbours', () => {
    const arranged = arrange([...stacked(3), { id: 99, x: 900, y: 900 }])
    expect(arranged.map((marker) => marker.id).sort()).toEqual([1, 2, 3])
  })

  it('treats markers exactly one cell apart as clear of each other', () => {
    expect(
      arrange([
        { id: 1, x: 0, y: 0 },
        { id: 2, x: CELL, y: 0 },
      ]),
    ).toEqual([])
  })
})

describe('a small group becomes a ring', () => {
  it('puts a coincident pair side by side, one cell apart, at full size', () => {
    const [first, second] = arrange(stacked(2))
    expect(first!.scale).toBe(1)
    expect(Math.hypot(first!.x - second!.x, first!.y - second!.y)).toBeCloseTo(CELL)
    expect((first!.x + second!.x) / 2).toBeCloseTo(400)
    expect((first!.y + second!.y) / 2).toBeCloseTo(300)
  })

  it('shrinks the icons as the ring fills, and never lets members overlap', () => {
    const scales = [3, 5, 6, 7, 8].map((count) => {
      const arranged = arrange(stacked(count))
      const { scale } = arranged[0]!
      expect(smallestGap(arranged)).toBeGreaterThanOrEqual(scale * CELL - 1e-6)
      return scale
    })

    for (let index = 1; index < scales.length; index++) {
      expect(scales[index]!).toBeLessThanOrEqual(scales[index - 1]!)
    }
    expect(scales[scales.length - 1]!).toBeLessThan(1)
  })

  it('keeps every member the same distance from the centre', () => {
    const arranged = arrange(stacked(6))
    const distances = arranged.map((marker) => Math.hypot(marker.x - 400, marker.y - 300))
    distances.forEach((distance) => expect(distance).toBeCloseTo(distances[0]!))
  })

  it('draws members in the compass order of their true positions', () => {
    const arranged = arrange([
      { id: 1, x: 390, y: 300 },
      { id: 2, x: 410, y: 300 },
    ])
    const west = arranged.find((marker) => marker.id === 1)!
    const east = arranged.find((marker) => marker.id === 2)!
    expect(west.x).toBeLessThan(east.x)
  })
})

describe('a larger group becomes a grid', () => {
  it('switches from ring to grid after the ring limit', () => {
    const ring = arrange(stacked(RING_MEMBER_LIMIT))
    const grid = arrange(stacked(RING_MEMBER_LIMIT + 1))
    const radii = (arranged: ArrangedMarker[]) =>
      arranged.map((marker) => Math.hypot(marker.x - 400, marker.y - 300))

    // Every ring member sits on the same circle; the centre cell of a 3 x 3 grid is on the centre.
    expect(Math.min(...radii(ring))).toBeGreaterThan(1)
    expect(Math.min(...radii(grid))).toBeLessThan(1)
  })

  it('lays members on a lattice whose pitch is the scaled cell', () => {
    const arranged = arrange(stacked(16))
    const { scale } = arranged[0]!
    const pitch = scale * CELL

    expect(smallestGap(arranged)).toBeCloseTo(pitch)
    arranged.forEach((marker) => {
      const column = (marker.x - 400) / pitch + 1.5
      const row = (marker.y - 300) / pitch + 1.5
      expect(column).toBeCloseTo(Math.round(column))
      expect(row).toBeCloseTo(Math.round(row))
    })
  })

  it('keeps the grid centred on where its members were', () => {
    const arranged = arrange(stacked(25))
    const xs = arranged.map((marker) => marker.x)
    const ys = arranged.map((marker) => marker.y)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(400)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(300)
  })

  it('shrinks with the count and stops at the smallest readable size', () => {
    const scales = [9, 16, 25].map((count) => arrange(stacked(count))[0]!.scale)
    expect(scales[0]!).toBeGreaterThan(scales[1]!)
    expect(scales[1]!).toBeGreaterThan(scales[2]!)

    // A hundred records on one spot cannot all be readable; the grid grows instead.
    const crowded = arrange(stacked(100))
    expect(crowded[0]!.scale).toBe(MIN_SCALE)
    expect(smallestGap(crowded)).toBeCloseTo(MIN_SCALE * CELL)
  })

  it('reads north to south, west to east', () => {
    const spread = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      x: 400 + ((index % 3) - 1) * 4,
      y: 300 + (Math.floor(index / 3) - 1) * 4,
    }))
    const arranged = arrange(spread)
    const at = (id: number) => arranged.find((marker) => marker.id === id)!

    expect(at(1).x).toBeLessThan(at(3).x)
    expect(at(1).y).toBeLessThan(at(7).y)
  })
})

describe('neighbouring groups', () => {
  it('merges two rings that would overlap, so the result has no overlapping icons', () => {
    const first = stacked(6, { x: 400, y: 300 }, 1)
    const second = stacked(6, { x: 400 + CELL * 1.1, y: 300 }, 100)
    const arranged = arrange([...first, ...second])

    expect(arranged).toHaveLength(12)
    expect(smallestGap(arranged)).toBeGreaterThanOrEqual(arranged[0]!.scale * CELL - 1e-6)
  })

  it('does not merge groups whose footprints are apart', () => {
    const arranged = arrange([
      ...stacked(2, { x: 100, y: 100 }),
      ...stacked(2, { x: 400, y: 100 }, 10),
    ])
    expect(arranged).toHaveLength(4)
    expect(arranged.every((marker) => marker.scale === 1)).toBe(true)
  })

  it('stops merging once the true spread would not fit, so a continuous district cannot become one grid', () => {
    const district = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      x: 100 + index * CELL * 0.9,
      y: 300,
    }))
    const arranged = arrange(district)
    const displacement = (marker: ArrangedMarker): number =>
      Math.hypot(marker.x - (100 + (marker.id - 1) * CELL * 0.9), marker.y - 300)

    expect(arranged.length).toBeGreaterThan(0)
    // Merged along the chain, 120 markers would fall into a few big grids and
    // the far ones of each would move across a whole run of cells. Held to
    // `MERGE_MAX_SPREAD`, each stays within a cell or two of where it is.
    expect(Math.max(...arranged.map(displacement))).toBeLessThan(CELL * 3)
  })
})

/** The deepest overlap in the drawn result, as a fraction of the smaller of the two icons. */
const worstOverlap = (markers: ArrangementMarker[], arranged: ArrangedMarker[]): number => {
  const drawn = markers.map((marker) => {
    const moved = arranged.find((candidate) => candidate.id === marker.id)
    return { x: moved?.x ?? marker.x, y: moved?.y ?? marker.y, width: CELL * (moved?.scale ?? 1) }
  })

  let worst = 0
  drawn.forEach((first, index) => {
    drawn.slice(index + 1).forEach((second) => {
      const depth =
        (first.width + second.width) / 2 - Math.hypot(first.x - second.x, first.y - second.y)
      worst = Math.max(worst, depth / Math.min(first.width, second.width))
    })
  })
  return worst
}

describe('what grouping alone leaves', () => {
  /** A district: `side` x `side` markers, `spacing` cells apart. */
  const district = (side: number, spacing: number): ArrangementMarker[] =>
    Array.from({ length: side * side }, (_, index) => ({
      id: index + 1,
      x: 200 + (index % side) * CELL * spacing,
      y: 200 + Math.floor(index / side) * CELL * spacing,
    }))

  it('settles a built-up district so no two icons overlap by more than a sliver', () => {
    const markers = district(7, 0.6)
    expect(worstOverlap(markers, arrange(markers))).toBeLessThan(0.15)
  })

  it('does so by shrinking where it is crowded, not by flinging markers away', () => {
    const markers = district(7, 0.6)
    const arranged = arrange(markers)
    const displaced = Math.max(
      ...arranged.map((placed) => {
        const origin = markers.find((marker) => marker.id === placed.id)!
        return Math.hypot(placed.x - origin.x, placed.y - origin.y)
      }),
    )

    expect(displaced).toBeLessThan(CELL * 3)
    expect(Math.min(...arranged.map((placed) => placed.scale))).toBeLessThan(1)
  })

  it('keeps a marker that is clear of the district where it is, at full size', () => {
    const markers = [...district(5, 0.5), { id: 999, x: 1200, y: 800 }]
    expect(arrange(markers).some((placed) => placed.id === 999)).toBe(false)
  })

  it('never shrinks an icon below the readable floor, however jammed', () => {
    const markers = district(12, 0.15)
    const arranged = arrange(markers)
    expect(Math.min(...arranged.map((placed) => placed.scale))).toBeGreaterThanOrEqual(
      MIN_SCALE - 1e-9,
    )
  })

  it('leaves two neighbouring rings that do not touch exactly as laid out', () => {
    const markers = [
      ...stacked(5, { x: 100, y: 100 }, 1),
      ...stacked(5, { x: 100 + CELL * 4, y: 100 }, 20),
    ]
    const arranged = arrange(markers)
    expect(arranged).toHaveLength(10)
    expect(worstOverlap(markers, arranged)).toBeLessThan(1e-6)
  })
})

describe('determinism', () => {
  it('gives the same arrangement whatever order the markers arrive in', () => {
    const markers = [
      ...stacked(5, { x: 100, y: 100 }, 1),
      ...stacked(12, { x: 130, y: 110 }, 20),
      { id: 50, x: 135, y: 95 },
    ]
    const shuffled = [...markers].reverse()
    const key = (arranged: ArrangedMarker[]) =>
      [...arranged]
        .sort((first, second) => first.id - second.id)
        .map(
          (marker) =>
            `${marker.id}:${marker.x.toFixed(4)}:${marker.y.toFixed(4)}:${marker.scale.toFixed(4)}`,
        )

    expect(key(arrange(shuffled))).toEqual(key(arrange(markers)))
  })

  it('is unmoved by a pan: shifting every marker shifts the arrangement by the same amount', () => {
    const markers = [...stacked(7, { x: 100, y: 100 }, 1), ...stacked(3, { x: 400, y: 250 }, 20)]
    const shifted = markers.map((marker) => ({ ...marker, x: marker.x + 123.5, y: marker.y - 77 }))
    const original = arrange(markers)
    const moved = arrange(shifted)

    original.forEach((marker) => {
      const twin = moved.find((candidate) => candidate.id === marker.id)!
      expect(twin.x - marker.x).toBeCloseTo(123.5)
      expect(twin.y - marker.y).toBeCloseTo(-77)
      expect(twin.scale).toBeCloseTo(marker.scale)
    })
  })

  it('ignores a non-positive cell size rather than dividing by it', () => {
    expect(arrangeMarkers(stacked(3), { cellSize: 0 })).toEqual([])
  })
})
