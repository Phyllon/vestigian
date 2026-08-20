import { describe, expect, it } from 'vitest'
import {
  buildTileCacheKey,
  CLUSTER_ZOOM_CEILING,
  getSimplifyTolerance,
  isValidTileCoordinate,
  planTileRender,
  TRACING_ZOOM_FLOOR,
} from '../mvt'

describe('isValidTileCoordinate', () => {
  it('accepts the root tile and an in-range tile', () => {
    expect(isValidTileCoordinate({ z: 0, x: 0, y: 0 })).toBe(true)
    expect(isValidTileCoordinate({ z: 12, x: 2145, y: 1391 })).toBe(true)
  })

  it('rejects coordinates outside the pyramid for their zoom', () => {
    expect(isValidTileCoordinate({ z: 1, x: 2, y: 0 })).toBe(false)
    expect(isValidTileCoordinate({ z: 1, x: 0, y: -1 })).toBe(false)
  })

  it('rejects non-integers and out-of-range zooms', () => {
    expect(isValidTileCoordinate({ z: 12.5, x: 1, y: 1 })).toBe(false)
    expect(isValidTileCoordinate({ z: 22, x: 1, y: 1 })).toBe(false)
    expect(isValidTileCoordinate({ z: Number.NaN, x: 0, y: 0 })).toBe(false)
  })
})

describe('getSimplifyTolerance', () => {
  it('halves as the zoom increases by one', () => {
    expect(getSimplifyTolerance(10) / getSimplifyTolerance(11)).toBeCloseTo(2, 5)
  })

  it('never returns a tolerance that would collapse a geometry', () => {
    expect(getSimplifyTolerance(18)).toBeGreaterThan(0)
  })
})

describe('planTileRender', () => {
  it('clusters below the ceiling and switches to features at it', () => {
    expect(planTileRender(CLUSTER_ZOOM_CEILING - 1).strategy).toBe('cluster')
    expect(planTileRender(CLUSTER_ZOOM_CEILING).strategy).toBe('feature')
  })

  it('withholds tracings until they are legible', () => {
    expect(planTileRender(TRACING_ZOOM_FLOOR - 1).includeTracings).toBe(false)
    expect(planTileRender(TRACING_ZOOM_FLOOR).includeTracings).toBe(true)
  })
})

describe('buildTileCacheKey', () => {
  it('changes when the data version is bumped', () => {
    const tile = { z: 8, x: 133, y: 87 }
    expect(buildTileCacheKey(tile, 1)).not.toBe(buildTileCacheKey(tile, 2))
  })
})
