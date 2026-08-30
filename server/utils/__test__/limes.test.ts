import { describe, expect, it } from 'vitest'
import { buildLimesCacheKey, buildLimesTileSql, planLimesRender } from '../limes'

const tile = { z: 8, x: 134, y: 86 }

describe('planLimesRender', () => {
  it('draws the frontier at every zoom', () => {
    // Unlike the atlas layers, there is no zoom at which the line is noise: it
    // is the one thing the reader switched this on for, and at zoom 3 it is the
    // whole shape of the empire.
    for (const zoom of [2, 5, 9, 14]) {
      expect(buildLimesTileSql({ tile, plan: planLimesRender(zoom) })).toContain("'frontier'")
    }
  })

  it('labels sectors only where a sector is the unit on screen', () => {
    // "Danube Limes" across a street plan describes nothing the reader is
    // looking at; below zoom 4 the label has no line long enough to sit on.
    expect(planLimesRender(6).includeSectorLabels).toBe(true)
    expect(planLimesRender(12).includeSectorLabels).toBe(false)
    expect(planLimesRender(3).includeSectorLabels).toBe(false)
  })

  it('simplifies harder the further out the reader is', () => {
    expect(planLimesRender(4).simplifyTolerance).toBeGreaterThan(
      planLimesRender(12).simplifyTolerance,
    )
  })
})

describe('buildLimesCacheKey', () => {
  it('rides the atlas generation rather than a third counter of its own', () => {
    // Both change only when an import runs, and `pnpm import:limes` clears
    // `atlas:v*` and `limes:v*` together.
    expect(buildLimesCacheKey(tile, 3)).toBe('limes:v3:8:134:86')
    expect(buildLimesCacheKey(tile, 4)).not.toBe(buildLimesCacheKey(tile, 3))
  })
})

describe('buildLimesTileSql', () => {
  it('filters in 4326 against the transformed envelope, never the other way round', () => {
    /**
     * The rule from `atlas.ts`, and the reason it is asserted here too: this
     * table is small enough that the wrong form would still feel fast, which is
     * exactly how it would get written and then stay until the frontier grew.
     */
    const sql = buildLimesTileSql({ tile, plan: planLimesRender(9) })
    expect(sql).toContain('limes_segments.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\(limes_segments\.geom, 3857\)\s*&&/)
  })

  it('carries the sector a stretch belongs to, so the line can name itself', () => {
    const sql = buildLimesTileSql({ tile, plan: planLimesRender(9) })
    expect(sql).toContain('sector_slug')
    expect(sql).toContain('sector_name')
    expect(sql).toContain('limes_segments.kind::text')
  })

  it('preserves topology when it simplifies', () => {
    // The sea gets the plain algorithm because a fold in a coastline is
    // cosmetic. A frontier that fragments into pieces is a different claim from
    // one that does not, and this is the line the reader is meant to follow.
    expect(buildLimesTileSql({ tile, plan: planLimesRender(6) })).toContain(
      'ST_SimplifyPreserveTopology',
    )
  })

  it('puts the sector label at the midpoint of the line, not at its centroid', () => {
    /**
     * The Dacian frontier is a loop, so its centroid falls in the middle of
     * Transylvania with no line under it — and a name floating in open country
     * reads as belonging to the country rather than to the frontier.
     */
    const sql = buildLimesTileSql({ tile, plan: planLimesRender(6) })
    expect(sql).toContain('ST_LineInterpolatePoint')
    expect(sql).not.toContain('ST_Centroid')
  })

  it('leaves the label layer out entirely below and above its band', () => {
    // Not merely hidden: a layer that is not in the tile costs no bytes.
    expect(buildLimesTileSql({ tile, plan: planLimesRender(12) })).not.toContain("'sectors'")
  })
})
