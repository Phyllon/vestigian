import { describe, expect, it } from 'vitest'
import {
  BARE_EARTH_COUNTRY_CODES,
  TOWER_HEIGHT_MODEL,
  buildSightlinePolygon,
  castSightlines,
  compassPointFor,
  curvatureDropMetres,
  describeRay,
  destinationPoint,
  distanceMetresBetween,
  initialBearingDegrees,
  isBareEarthLikely,
  longestUnbroken,
  summariseSectors,
  towerEyeHeights,
  towerTopHeights,
  traceRay,
  traceSightLine,
} from '../sightline'
import type { ElevationSampler, SightObserver } from '../sightline'

const ORIGIN = { lon: 8.5, lat: 50.2 }

const observers = (keepGrid = false): SightObserver[] =>
  (['low', 'central', 'high'] as const).map((variant) => ({
    id: variant,
    eyeHeightMetres: towerEyeHeights()[variant],
    targetHeightMetres: TOWER_HEIGHT_MODEL.targetHeightMetres,
    keepGrid,
  }))

const baseRequest = (
  sampler: ElevationSampler,
  overrides: Partial<{ radiusMetres: number; keepGrid: boolean }> = {},
) => ({
  origin: ORIGIN,
  originElevationMetres: 0,
  observers: observers(overrides.keepGrid),
  radiusMetres: overrides.radiusMetres ?? 10_000,
  rayCount: 360,
  stepMetres: 25,
  sampler,
  grid: { columns: 360, binMetres: 100, binCount: 100 },
})

describe('the height model', () => {
  it('puts the eye 1.6 m above a platform that is a range, not a single number', () => {
    expect(towerEyeHeights()).toEqual({ low: 7.6, central: 9.1, high: 10.1 })
  })

  it('adds a roof to the platform for the tower as a thing to be seen, inside the 10 to 12 m the sources give', () => {
    const tops = towerTopHeights()
    expect(tops).toEqual({ low: 8.5, central: 10, high: 11 })
  })

  it('keeps the middle estimate between the other two, so the dashed outlines bracket it', () => {
    const { low, central, high } = TOWER_HEIGHT_MODEL.platformMetres
    expect(low).toBeLessThan(central)
    expect(central).toBeLessThan(high)
  })
})

describe('where a bare-earth survey can be assumed', () => {
  it('knows the frontier countries with a national terrain model', () => {
    for (const code of ['DE', 'AT', 'SK', 'GB', 'NL', 'RO'])
      expect(isBareEarthLikely(code)).toBe(true)
  })

  it('does not assume it for countries that fall back to a surface model', () => {
    // Read from Mapterhorn's source catalogue: no open national model for these.
    for (const code of ['HU', 'RS', 'BG', 'HR', 'TR']) {
      expect(BARE_EARTH_COUNTRY_CODES.has(code)).toBe(false)
      expect(isBareEarthLikely(code)).toBe(false)
    }
  })

  it('treats an unknown country as not assumed, and ignores case', () => {
    expect(isBareEarthLikely(null)).toBe(false)
    expect(isBareEarthLikely('de')).toBe(true)
  })
})

describe('the earth under the line', () => {
  it('drops about 6.8 m at ten kilometres once refraction has given some back', () => {
    // d² / 2R is 7.85 m; the standard coefficient of 0.13 leaves 87% of it.
    expect(curvatureDropMetres(10_000)).toBeCloseTo(6.83, 1)
    expect(curvatureDropMetres(0)).toBe(0)
  })

  it('goes a degree of latitude in 111 km due north', () => {
    const point = destinationPoint({ lon: 8, lat: 50 }, 0, 111_195)
    expect(point.lat).toBeCloseTo(51, 2)
    expect(point.lon).toBeCloseTo(8, 6)
  })

  it('measures a distance and a bearing back to where it came from', () => {
    const there = destinationPoint(ORIGIN, 135, 4_000)
    expect(distanceMetresBetween(ORIGIN, there)).toBeCloseTo(4_000, 0)
    expect(initialBearingDegrees(ORIGIN, there)).toBeCloseTo(135, 1)
  })

  it('names the eight compass points and wraps past north', () => {
    expect(compassPointFor(0)).toBe('n')
    expect(compassPointFor(44)).toBe('ne')
    expect(compassPointFor(359)).toBe('n')
    expect(compassPointFor(210)).toBe('sw')
    expect(compassPointFor(-90)).toBe('w')
  })
})

describe('casting sight lines over flat ground', () => {
  const flat: ElevationSampler = () => 0
  const cast = castSightlines(baseRequest(flat))

  it('sees to the limit in every direction', () => {
    for (const variant of ['low', 'central', 'high'] as const) {
      const { unbrokenMetres } = cast.observers[variant]!
      expect(unbrokenMetres).toHaveLength(360)
      expect(Math.min(...unbrokenMetres)).toBe(10_000)
    }
  })

  it('counts a disc: pi r² to within a per cent', () => {
    const expected = Math.PI * 10_000 ** 2
    expect(cast.observers.central!.unbrokenAreaSquareMetres).toBeGreaterThan(expected * 0.99)
    expect(cast.observers.central!.unbrokenAreaSquareMetres).toBeLessThan(expected * 1.01)
  })

  it('has no ground it could not see, so the two areas agree', () => {
    expect(cast.observers.central!.visibleAreaSquareMetres).toBeCloseTo(
      cast.observers.central!.unbrokenAreaSquareMetres,
      0,
    )
  })

  it('reports no missing terrain', () => {
    expect(cast.missingSampleCount).toBe(0)
    expect(cast.sampleCount).toBeGreaterThan(0)
  })
})

describe('a ridge that stands in the way', () => {
  // A 60 m ridge running east-west, 300 m north of the tower.
  const ridgeLatitude = ORIGIN.lat + 300 / 111_195
  const walled: ElevationSampler = (_lon, lat) => (lat >= ridgeLatitude ? 60 : 0)
  const cast = castSightlines(baseRequest(walled))

  it('ends the view to the north where the ridge begins', () => {
    const north = cast.observers.central!.unbrokenMetres[0]!
    expect(north).toBeGreaterThan(250)
    expect(north).toBeLessThan(330)
  })

  it('leaves the view to the south untouched', () => {
    expect(cast.observers.central!.unbrokenMetres[180]).toBe(10_000)
  })

  it('shrinks the open ground without touching the southern half', () => {
    const flat = Math.PI * 10_000 ** 2
    expect(cast.observers.central!.unbrokenAreaSquareMetres).toBeLessThan(flat * 0.6)
    expect(cast.observers.central!.unbrokenAreaSquareMetres).toBeGreaterThan(flat * 0.4)
  })
})

describe('a low rise, which only a higher platform sees past', () => {
  // An 8 m bank 300 m north, falling back to level ground beyond it.
  const bankLatitude = ORIGIN.lat + 300 / 111_195
  const bankEndLatitude = ORIGIN.lat + 330 / 111_195
  const bank: ElevationSampler = (_lon, lat) =>
    lat >= bankLatitude && lat < bankEndLatitude ? 8 : 0
  const cast = castSightlines(baseRequest(bank))

  it('stops the unbroken view at the bank at every height', () => {
    for (const variant of ['low', 'central', 'high'] as const) {
      expect(cast.observers[variant]!.unbrokenMetres[0]).toBeLessThan(340)
    }
  })

  it('sees further behind it from a higher platform', () => {
    expect(cast.observers.high!.visibleAreaSquareMetres).toBeGreaterThan(
      cast.observers.low!.visibleAreaSquareMetres,
    )
  })

  it('counts ground that comes back into view beyond the bank as seen, not as unbroken', () => {
    expect(cast.observers.high!.farthestVisible.metres).toBeGreaterThan(
      cast.observers.high!.unbrokenMetres[0]!,
    )
    expect(cast.observers.high!.visibleAreaSquareMetres).toBeGreaterThan(
      cast.observers.high!.unbrokenAreaSquareMetres,
    )
  })
})

describe('terrain that runs out', () => {
  it('stops a ray at the last ground it measured rather than claiming the rest', () => {
    const tileEdgeLatitude = ORIGIN.lat + 1_000 / 111_195
    const edged: ElevationSampler = (_lon, lat) => (lat > tileEdgeLatitude ? null : 0)
    const cast = castSightlines(baseRequest(edged))

    expect(cast.observers.central!.unbrokenMetres[0]).toBeLessThanOrEqual(1_000)
    expect(cast.observers.central!.unbrokenMetres[0]).toBeGreaterThan(900)
    expect(cast.missingSampleCount).toBeGreaterThan(0)
  })
})

describe('the shape of the view', () => {
  it('finds the longest run and the bearing it points along', () => {
    const radii = new Array<number>(360).fill(500)
    radii[90] = 7_000
    expect(longestUnbroken(radii)).toEqual({ metres: 7_000, bearing: 90 })
  })

  it('summarises eight compass sectors by their middle and their narrowest', () => {
    const radii = new Array<number>(360).fill(1_000)
    // The north sector is 337.5–22.5°, so rays 0–22 and 338–359.
    for (let ray = 0; ray <= 22; ray++) radii[ray] = 200
    for (let ray = 338; ray < 360; ray++) radii[ray] = 200
    radii[5] = 50
    const sectors = summariseSectors(radii)

    expect(sectors).toHaveLength(8)
    expect(sectors[0]).toMatchObject({ compass: 'n', medianMetres: 200, shortestMetres: 50 })
    expect(sectors[2]).toMatchObject({ compass: 'e', medianMetres: 1_000, shortestMetres: 1_000 })
  })

  it('builds a closed ring, one point per ray, starting due north of the tower', () => {
    const ring = buildSightlinePolygon(ORIGIN, new Array<number>(360).fill(1_000))
    expect(ring).toHaveLength(361)
    expect(ring[0]).toEqual(ring[360])
    expect(ring[0]![0]).toBeCloseTo(ORIGIN.lon, 4)
    expect(ring[0]![1]).toBeGreaterThan(ORIGIN.lat)
  })
})

describe('whether two towers can see each other', () => {
  const there = destinationPoint(ORIGIN, 90, 2_000)
  const eye = towerEyeHeights().central

  const trace = (sampler: ElevationSampler) =>
    traceSightLine({
      from: ORIGIN,
      to: there,
      fromEyeElevationMetres: eye,
      toEyeElevationMetres: eye,
      stepMetres: 15,
      sampler,
      maximumProfilePoints: 64,
    })

  it('is clear over level ground, with the margin of the eye height', () => {
    const result = trace(() => 0)
    expect(result.isClear).toBe(true)
    expect(result.minimumClearanceMetres).toBeGreaterThan(eye - 1)
    expect(result.distanceMetres).toBeCloseTo(2_000, 0)
  })

  it('is blocked by a hill between them, and says where and by how much', () => {
    // A 40 m hill centred half way.
    const hill: ElevationSampler = (lon) => {
      const along = distanceMetresBetween(ORIGIN, { lon, lat: ORIGIN.lat })
      return Math.abs(along - 1_000) < 150 ? 40 : 0
    }
    const result = trace(hill)

    expect(result.isClear).toBe(false)
    expect(result.minimumClearanceMetres).toBeLessThan(-25)
    expect(result.tightestAtMetres).toBeGreaterThan(800)
    expect(result.tightestAtMetres).toBeLessThan(1_200)
  })

  it('is the same answer from either end, with the obstacle nearer one of them', () => {
    // A 30 m rise 300 m from the western tower: on the line, and nowhere near its middle.
    const rise: ElevationSampler = (lon) => {
      const along = distanceMetresBetween(ORIGIN, { lon, lat: ORIGIN.lat })
      return Math.abs(along - 300) < 100 ? 30 : 0
    }
    const forward = trace(rise)
    const back = traceSightLine({
      from: there,
      to: ORIGIN,
      fromEyeElevationMetres: eye,
      toEyeElevationMetres: eye,
      stepMetres: 15,
      sampler: rise,
      maximumProfilePoints: 64,
    })

    expect(forward.isClear).toBe(false)
    expect(back.isClear).toBe(false)
    expect(back.minimumClearanceMetres).toBeCloseTo(forward.minimumClearanceMetres, 0)
    expect(back.tightestAtMetres).toBeCloseTo(2_000 - forward.tightestAtMetres, -1)
  })

  it('does not call a line clear when part of the ground between was never read', () => {
    const gappy: ElevationSampler = (lon) =>
      lon > ORIGIN.lon + (there.lon - ORIGIN.lon) / 2 ? null : 0
    const result = trace(gappy)
    expect(result.isIncomplete).toBe(true)
    expect(result.isClear).toBe(false)
  })

  it('keeps the profile within the points asked for, ends included', () => {
    const result = trace(() => 0)
    expect(result.profile.distances.length).toBeLessThanOrEqual(65)
    expect(result.profile.distances[0]).toBe(0)
    expect(result.profile.distances[result.profile.distances.length - 1]).toBeCloseTo(2_000, 0)
    expect(result.profile.terrain).toHaveLength(result.profile.distances.length)
    expect(result.profile.sight).toHaveLength(result.profile.distances.length)
  })
})

/**
 * A rim: level ground to 200 m north, a 40 m drop to a flat valley floor, then a
 * far slope rising from 3 km.
 */
const rimTerrain: ElevationSampler = (_lon, lat) => {
  const north = (lat - ORIGIN.lat) * 111_195
  if (north < 200) return 0
  if (north < 3_000) return -40
  return -40 + (north - 3_000) * 0.03
}

describe('the cells of ground seen', () => {
  // A rim: level ground to 200 m north, a 40 m drop to a flat valley floor, then a
  // far slope rising from 3 km.
  const rim = rimTerrain

  it('keeps the grid only for the observer that asked, and only when asked', () => {
    const without = castSightlines(baseRequest(() => 0))
    expect(without.observers.central!.seenCells).toBeUndefined()

    const asked = castSightlines(baseRequest(() => 0, { keepGrid: true }))
    expect(asked.observers.central!.seenCells).toHaveLength(360 * 100)
  })

  it('sees every cell on level ground', () => {
    const cast = castSightlines(baseRequest(() => 0, { keepGrid: true }))
    const cells = cast.observers.central!.seenCells!
    expect(cells.reduce((sum, cell) => sum + cell, 0)).toBe(360 * 100)
  })

  it('shows the valley as dead ground and the far slope as seen again', () => {
    const cast = castSightlines(baseRequest(rim, { keepGrid: true }))
    const cells = cast.observers.central!.seenCells!
    const column = 0 // due north
    const at = (metres: number): number => cells[column * 100 + Math.floor(metres / 100)]!

    expect(at(50), 'the ground before the bank').toBe(1)
    // Eyes 9.1 m up, a 40 m drop: the shadow behind the lip is about a kilometre long.
    expect(at(600), 'the valley floor just behind the bank, in its shadow').toBe(0)
    expect(at(1_500), 'the valley floor beyond the shadow, seen again').toBe(1)
    expect(at(6_000), 'the far slope, risen into view').toBe(1)
  })

  it('draws the unbroken outline at the bank, not at the far slope', () => {
    const cast = castSightlines(baseRequest(rim, { keepGrid: true }))
    expect(cast.observers.central!.unbrokenMetres[0]).toBeLessThan(260)
    expect(cast.observers.central!.farthestVisible.metres).toBeGreaterThan(5_000)
  })
})

describe('a hummock before a valley', () => {
  // A 3 m rise 100 m out hides a short patch behind it; a 50 m edge at 400 m
  // hides a far longer one. "What shrinks the view" is the second.
  const hummock: ElevationSampler = (_lon, lat) => {
    const metres = (lat - ORIGIN.lat) * 111_195
    if (metres < 0) return 0
    if (metres >= 100 && metres < 150) return 3
    if (metres >= 400) return -50
    return 0
  }
  const trace = traceRay({
    origin: ORIGIN,
    originElevationMetres: 0,
    bearingDegrees: 0,
    eyeHeightMetres: 9.1,
    targetHeightMetres: 1.7,
    radiusMetres: 5_000,
    stepMetres: 25,
    sampler: hummock,
  })
  const ray = describeRay({ trace, towerGroundMetres: 0, stepMetres: 25 })

  it('reports the long shadow as the dead ground, not the nearer short one', () => {
    expect(ray.deadGround).not.toBeNull()
    const length = ray.deadGround!.toMetres - ray.deadGround!.fromMetres
    expect(length).toBeGreaterThan(400)
    expect(ray.deadGround!.crest.atMetres).toBeGreaterThanOrEqual(375)
    expect(ray.deadGround!.crest.atMetres).toBeLessThanOrEqual(400)
    expect(ray.deadGround!.reappearsAt!.atMetres).toBeGreaterThan(ray.deadGround!.toMetres)
  })

  it('still names the first obstruction, wherever that is', () => {
    expect(ray.firstBlock).not.toBeNull()
    expect(ray.firstBlock!.atMetres).toBeLessThan(400)
  })
})

describe('one line, in the terms of the cast', () => {
  const rim = rimTerrain
  const trace = (bearingDegrees: number) =>
    traceRay({
      origin: ORIGIN,
      originElevationMetres: 0,
      bearingDegrees,
      eyeHeightMetres: towerEyeHeights().central,
      targetHeightMetres: 1.7,
      radiusMetres: 10_000,
      stepMetres: 25,
      sampler: rim,
    })

  it('agrees with the cast about where the unbroken view ends', () => {
    const cast = castSightlines(baseRequest(rim))
    const traced = trace(0)
    const firstHidden = traced.distances[traced.isSeen.indexOf(false)]!
    // The cast reports the last seen distance; the trace names the first hidden one.
    expect(firstHidden - 25).toBe(cast.observers.central!.unbrokenMetres[0])
  })

  it('names the bank as what ends the view, and the far slope as where it comes back', () => {
    const traced = trace(0)
    const ray = describeRay({ trace: traced, towerGroundMetres: 0, stepMetres: 25 })

    expect(ray.firstBlock).not.toBeNull()
    expect(ray.firstBlock!.atMetres).toBeGreaterThan(150)
    expect(ray.firstBlock!.atMetres).toBeLessThan(260)
    // Ground level beside the tower's feet, 9.1 m below the eyes.
    expect(ray.firstBlock!.aboveTowerGroundMetres).toBe(0)
    expect(ray.firstBlock!.aboveEyeMetres).toBeCloseTo(-9.1, 1)

    expect(ray.deadGround).not.toBeNull()
    expect(ray.deadGround!.crest.atMetres).toBe(ray.firstBlock!.atMetres)
    expect(ray.deadGround!.fromMetres).toBeLessThan(300)
    // 40 m below the eye line: back in view about a kilometre out.
    expect(ray.deadGround!.reappearsAt).not.toBeNull()
    expect(ray.deadGround!.reappearsAt!.atMetres).toBeGreaterThan(900)
    expect(ray.deadGround!.reappearsAt!.atMetres).toBeLessThan(1_300)
    expect(ray.deadGround!.reappearsAt!.aboveTowerGroundMetres).toBe(-40)
    expect(ray.hiddenMetres).toBeGreaterThan(700)
    expect(ray.farthestSeenMetres).toBeGreaterThan(9_000)
  })

  it('says there is no block, and nothing to reappear, where nothing stands in the way', () => {
    const level = traceRay({
      origin: ORIGIN,
      originElevationMetres: 0,
      bearingDegrees: 180,
      eyeHeightMetres: 9.1,
      targetHeightMetres: 1.7,
      radiusMetres: 5_000,
      stepMetres: 25,
      sampler: () => 0,
    })
    const ray = describeRay({ trace: level, towerGroundMetres: 0, stepMetres: 25 })
    expect(ray.firstBlock).toBeNull()
    expect(ray.deadGround).toBeNull()
    expect(ray.hiddenMetres).toBe(0)
    expect(ray.segments).toEqual([{ fromMetres: 0, toMetres: 5_000, isSeen: true }])
  })

  it('divides the line into seen and hidden stretches that tile it', () => {
    const ray = describeRay({ trace: trace(0), towerGroundMetres: 0, stepMetres: 25 })
    expect(ray.segments.length).toBeGreaterThanOrEqual(3)
    expect(ray.segments[0]!.isSeen).toBe(true)
    expect(ray.segments[1]!.isSeen).toBe(false)
    ray.segments.slice(1).forEach((segment, index) => {
      expect(segment.fromMetres).toBe(ray.segments[index]!.toMetres)
    })
  })
})
