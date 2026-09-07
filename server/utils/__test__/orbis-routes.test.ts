import { describe, expect, it } from 'vitest'
import { buildRouteCacheKey, buildRouteTileSql } from '../orbis-routes'

const tile = { z: 8, x: 134, y: 86 }

describe('buildRouteCacheKey', () => {
  it('rides the atlas generation rather than a third counter of its own', () => {
    expect(buildRouteCacheKey(tile, 3)).toBe('route:v3:8:134:86')
    expect(buildRouteCacheKey(tile, 4)).not.toBe(buildRouteCacheKey(tile, 3))
  })
})

describe('buildRouteTileSql', () => {
  it('filters in 4326 against the transformed envelope, never the other way round', () => {
    const sql = buildRouteTileSql(tile)
    expect(sql).toContain('antiquity_routes.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\(antiquity_routes\.geom, 3857\)\s*&&/)
  })

  it('carries what the popup needs and nothing more', () => {
    const sql = buildRouteTileSql(tile)
    expect(sql).toContain('antiquity_routes.route_type')
    expect(sql).toContain('antiquity_routes.source_title')
    expect(sql).toContain('antiquity_routes.target_title')
  })

  it('draws one line layer, unsimplified — there is nothing to thin at ~1,300 rows', () => {
    const sql = buildRouteTileSql(tile)
    expect(sql).toContain("'routes'")
    expect(sql).not.toContain('ST_Simplify')
  })
})
