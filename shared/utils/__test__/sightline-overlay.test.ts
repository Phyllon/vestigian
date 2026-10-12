import { describe, expect, it } from 'vitest'
import type { TowerRaySection, TowerSightlines } from '../../types'
import { encodeSeenCells } from '../seen-grid'
import {
  SIGHTLINE_RING_METRES,
  buildRayLines,
  buildSightlineMapGeometry,
} from '../sightline-overlay'

const SHAPE = { columns: 360, binMetres: 100, binCount: 100 }

const gridWith = (marks: [column: number, fromBin: number, toBin: number][]) => {
  const cells = new Uint8Array(SHAPE.columns * SHAPE.binCount)
  for (const [column, fromBin, toBin] of marks) {
    for (let bin = fromBin; bin < toBin; bin++) cells[column * SHAPE.binCount + bin] = 1
  }
  return { ...SHAPE, data: encodeSeenCells(cells) }
}

const variant = (unbroken: number[], farthest: { metres: number; bearing: number }) => ({
  eyeHeightMetres: 9.1,
  unbrokenMetres: unbroken,
  unbrokenAreaSquareKm: 0.5,
  visibleAreaSquareKm: 5,
  longestUnbroken: { metres: 400, bearing: 90 },
  farthestVisible: farthest,
  sectors: [],
})

const radii = (metres: number): number[] => new Array<number>(720).fill(metres)

const tower = (): TowerSightlines =>
  ({
    siteId: 1,
    position: { lon: 11.6, lat: 48.9 },
    variants: {
      low: variant(radii(150), { metres: 5_000, bearing: 80 }),
      central: variant(radii(200), { metres: 6_000, bearing: 82 }),
      high: variant(radii(250), { metres: 7_000, bearing: 84 }),
    },
    viewGrid: gridWith([
      [10, 0, 2],
      [10, 40, 50],
    ]),
    seenFrom: {
      towerMetres: { low: 8.5, central: 10, high: 11 },
      onlookerEyeMetres: 1.6,
      visibleAreaSquareKm: { low: 1, central: 2, high: 3 },
      farthestVisible: { metres: 9_000, bearing: 200 },
      grid: gridWith([[200, 0, 90]]),
    },
    neighbours: [],
  }) as unknown as TowerSightlines

const text = {
  distance: (metres: number): string => (metres < 1000 ? `${metres} m` : `${metres / 1000} km`),
  compassShort: (point: string): string => point.toUpperCase(),
  farthest: (metres: number): string => `far ${metres}`,
}

describe('what the map draws for a tower', () => {
  it('draws the unbroken outlines and the seen wedges in the view, a ring per distance', () => {
    const geometry = buildSightlineMapGeometry(tower(), 'view', text)

    expect(geometry.outlines).not.toBeNull()
    expect(geometry.outlines!.central).toHaveLength(721)
    // Two runs in one wedge.
    expect(geometry.seenRings).toHaveLength(2)
    expect(geometry.distanceCircles.map((circle) => circle.radiusMetres)).toEqual([
      ...SIGHTLINE_RING_METRES,
    ])
  })

  it('writes the open distance at each of the eight spokes, and the farthest ground seen once', () => {
    const { labels } = buildSightlineMapGeometry(tower(), 'view', text)
    const spokes = labels.filter((label) => label.role === 'spoke')

    expect(spokes).toHaveLength(8)
    expect(spokes[0]!.text).toBe('N 200 m')
    expect(spokes[2]!.text).toBe('E 200 m')
    expect(labels.filter((label) => label.role === 'farthest')).toEqual([
      expect.objectContaining({ text: 'far 6000' }),
    ])
  })

  it('labels every ring with its own distance', () => {
    const { labels } = buildSightlineMapGeometry(tower(), 'view', text)
    expect(labels.filter((label) => label.role === 'ring').map((label) => label.text)).toEqual([
      '500 m',
      '1 km',
      '2 km',
      '5 km',
      '10 km',
    ])
  })

  it('turns to where the tower is seen from: blue wedges, no outline, the far distance at the spokes', () => {
    const geometry = buildSightlineMapGeometry(tower(), 'seenFrom', text)

    expect(geometry.outlines).toBeNull()
    expect(geometry.seenRings).toHaveLength(1)
    const spokes = geometry.labels.filter((label) => label.role === 'spoke')
    // The only seen wedge is column 200, bearing 200.5°: the southern sector (157.5–202.5°).
    expect(spokes).toHaveLength(1)
    expect(spokes[0]!.text).toBe('S 9 km')
  })

  it('keeps a spoke label off the mark when the view is shut in', () => {
    const shut = tower()
    shut.variants.central = variant(radii(10), { metres: 6_000, bearing: 82 })
    const { labels } = buildSightlineMapGeometry(shut, 'view', text)
    const north = labels.find((label) => label.role === 'spoke')!
    // 40 m is about 0.00036° of latitude: the label stands clear of the tower itself.
    expect(north.position.lat - 48.9).toBeGreaterThan(0.0003)
  })
})

describe('one compass line on the map', () => {
  const ray = {
    bearing: 90,
    segments: [
      { fromMetres: 0, toMetres: 250, isSeen: true },
      { fromMetres: 250, toMetres: 1_000, isSeen: false },
    ],
  } as TowerRaySection

  it('draws seen stretches and hidden ones as separate lines, end to end', () => {
    const lines = buildRayLines({ lon: 11.6, lat: 48.9 }, ray)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.isSeen).toBe(true)
    expect(lines[1]!.isSeen).toBe(false)
    expect(lines[0]!.coordinates[1]).toEqual(lines[1]!.coordinates[0])
    // Due east: longitude grows, latitude holds.
    expect(lines[1]!.coordinates[1][0]).toBeGreaterThan(lines[1]!.coordinates[0][0])
  })
})
