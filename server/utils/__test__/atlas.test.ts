import { describe, expect, it } from 'vitest'
import {
  buildAtlasCacheKey,
  buildAtlasTileSql,
  buildPeriodExtentCacheKey,
  buildPeriodExtentTileSql,
  planAtlasRender,
} from '../atlas'

const tile = { z: 8, x: 134, y: 86 }

describe('planAtlasRender', () => {
  it('shows only the coast and the major routes at continental zoom', () => {
    // A zoom 4 tile covers half of Europe. Every track and aqueduct in it would
    // be a smear, and the payload would be the largest at the zoom people open
    // the map on.
    const plan = planAtlasRender(4)
    expect(plan.includeDetailLines).toBe(false)
    expect(plan.includePlaces).toBe(false)
    expect(plan.includeAreas).toBe(false)
  })

  it('adds the detail once there is room to read it', () => {
    const plan = planAtlasRender(9)
    expect(plan.includeDetailLines).toBe(true)
    expect(plan.includePlaces).toBe(true)
  })

  it('drops region names once they no longer describe what is on screen', () => {
    // "GALLIA BELGICA" across a street plan is noise; the province is no longer
    // the unit the reader is looking at.
    expect(planAtlasRender(9).includeRegions).toBe(true)
    expect(planAtlasRender(12).includeRegions).toBe(false)
    expect(planAtlasRender(3).includeRegions).toBe(false)
  })
})

describe('buildAtlasTileSql', () => {
  it('always carries water and linework', () => {
    const sql = buildAtlasTileSql({ tile, plan: planAtlasRender(3) })
    expect(sql).toContain("'water'")
    expect(sql).toContain("'lines'")
  })

  it('restricts the linework to coast and major roads before the detail zoom', () => {
    const sql = buildAtlasTileSql({ tile, plan: planAtlasRender(4) })
    expect(sql).toContain("antiquity_lines.kind = 'shoreline'")
    expect(sql).not.toContain("'places'")
  })

  it('adds a layer per zoom band rather than filtering client-side', () => {
    const sql = buildAtlasTileSql({ tile, plan: planAtlasRender(9) })
    for (const layer of ["'water'", "'lines'", "'areas'", "'regions'", "'places'"]) {
      expect(sql).toContain(layer)
    }
  })

  it('reads region labels from the point derived at import, not the linework', () => {
    // Taking a centroid per tile would recompute it for every tile the region
    // touches, and would move the label as the viewport clipped the outline.
    const sql = buildAtlasTileSql({ tile, plan: planAtlasRender(6) })
    expect(sql).toContain('antiquity_regions.label_geom')
    expect(sql).not.toContain('ST_Centroid')
  })
})

describe('buildAtlasCacheKey', () => {
  it('is keyed separately from the site pyramid', () => {
    // The atlas changes only when the import runs. Sharing the site data
    // version would throw away every coastline tile each time a moderator
    // approved a photograph.
    expect(buildAtlasCacheKey(tile, 3)).toBe('atlas:v3:8:134:86')
    expect(buildAtlasCacheKey(tile, 3)).not.toContain('tile:')
  })
})

describe('buildPeriodExtentCacheKey', () => {
  it('folds the period into the key, so 117 CE and 200 CE never collide', () => {
    expect(buildPeriodExtentCacheKey(tile, 3, 117)).toBe('atlas:v3:period:117:8:134:86')
    expect(buildPeriodExtentCacheKey(tile, 3, 117)).not.toBe(
      buildPeriodExtentCacheKey(tile, 3, 200),
    )
  })

  it('rides the atlas generation rather than a counter of its own', () => {
    // Same reasoning as buildLimesCacheKey — this data changes on the same
    // clock as the rest of the antiquity import, not its own.
    expect(buildPeriodExtentCacheKey(tile, 5, -60)).toContain('atlas:v5:')
  })
})

describe('buildPeriodExtentTileSql', () => {
  it('filters to exactly one period, never the other two', () => {
    const sql = buildPeriodExtentTileSql({ tile, periodYear: 117, simplifyTolerance: 0.01 })
    expect(sql).toContain('antiquity_period_extents.period_year = 117')
    expect(sql).not.toContain('period_year = -60')
    expect(sql).not.toContain('period_year = 200')
  })

  it('compares in 4326 against the transformed envelope, never 3857', () => {
    // The same GiST-index regression documented for buildAtlasTileSql and
    // buildLimesTileSql: `ST_Transform(geom, 3857) && env` cannot use the
    // index the stored geometry is built on.
    const sql = buildPeriodExtentTileSql({ tile, periodYear: 200, simplifyTolerance: 0.01 })
    expect(sql).toContain('antiquity_period_extents.geom && b.env_wgs')
    expect(sql).not.toContain('ST_Transform(antiquity_period_extents.geom, 3857) &&')
  })

  it('produces one layer, named for the fill it is', () => {
    const sql = buildPeriodExtentTileSql({ tile, periodYear: -60, simplifyTolerance: 0.01 })
    expect(sql).toContain("'extent'")
  })
})
