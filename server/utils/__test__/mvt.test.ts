import { describe, expect, it } from 'vitest'
import {
  buildClusterTileSql,
  buildFeatureTileSql,
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

  it('serves individual sites below the ceiling when every site is asked for', () => {
    const plan = planTileRender(CLUSTER_ZOOM_CEILING - 1, { showEverySite: true })
    expect(plan.strategy).toBe('feature')
    expect(plan.compactSiteProperties).toBe(true)
  })

  it('keeps full site properties once the tile is at or past the ceiling', () => {
    expect(
      planTileRender(CLUSTER_ZOOM_CEILING, { showEverySite: true }).compactSiteProperties,
    ).toBe(false)
    expect(planTileRender(3).compactSiteProperties).toBe(false)
  })

  it('keys the every-site variant apart from the clustered tile', () => {
    const tile = { z: 4, x: 8, y: 5 }
    expect(buildTileCacheKey(tile, 3)).toBe('tile:v3:4:8:5')
    expect(buildTileCacheKey(tile, 3, { showEverySite: true })).not.toBe(buildTileCacheKey(tile, 3))
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

describe('buildFeatureTileSql', () => {
  const build = (includeTracings: boolean) =>
    buildFeatureTileSql({
      tile: { z: 10, x: 543, y: 380 },
      simplifyTolerance: getSimplifyTolerance(10),
      includeTracings,
      compactSiteProperties: false,
    })

  // `ST_Transform(geom, 3857) && env` cannot use the GiST indexes on the 4326
  // column: it was a sequential scan per cache miss, and the cause of the
  // TileRenderSlow alert. The filter must compare the raw column.
  it('filters sites and tracings on the raw geometry column so the GiST index applies', () => {
    const sql = build(true)
    expect(sql).toContain('sites.geom && b.env_wgs')
    expect(sql).toContain('tracings.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\((sites|tracings)\.geom, 3857\) &&/)
  })

  it('keeps the approved-status predicate that the partial indexes need', () => {
    expect(build(true)).toContain("sites.status = 'approved'")
    expect(build(true)).toContain("tracings.status = 'approved'")
  })
})

describe('buildClusterTileSql', () => {
  const sql = buildClusterTileSql({ tile: { z: 6, x: 33, y: 22 }, gridSize: 100000 })

  // Without the raw-column comparison the query reprojects every site on every
  // miss and the latency SLO on this route cannot be met.
  it('prefilters on the raw geometry column so the GiST index applies', () => {
    expect(sql).toContain('s.geom && b.env_expanded_wgs')
  })

  it('keeps the exact projected comparison and the approved-status predicate', () => {
    expect(sql).toContain('ST_Transform(s.geom, 3857) && b.env_expanded')
    expect(sql).toContain("s.status = 'approved'")
  })
})
