import { describe, expect, it } from 'vitest'
import { buildAtlasCacheKey, buildAtlasTileSql, planAtlasRender } from '../atlas'

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
