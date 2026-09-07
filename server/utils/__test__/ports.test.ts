import { describe, expect, it } from 'vitest'
import { buildPortCacheKey, buildPortTileSql } from '../ports'

const tile = { z: 8, x: 134, y: 86 }

describe('buildPortCacheKey', () => {
  it('rides the atlas generation rather than a third counter of its own', () => {
    expect(buildPortCacheKey(tile, 3)).toBe('port:v3:8:134:86')
    expect(buildPortCacheKey(tile, 4)).not.toBe(buildPortCacheKey(tile, 3))
  })
})

describe('buildPortTileSql', () => {
  it('filters in 4326 against the transformed envelope, never the other way round', () => {
    const sql = buildPortTileSql(tile)
    expect(sql).toContain('antiquity_ports.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\(antiquity_ports\.geom, 3857\)\s*&&/)
  })

  it('carries what the popup needs and nothing more', () => {
    const sql = buildPortTileSql(tile)
    expect(sql).toContain('antiquity_ports.title')
    expect(sql).toContain('antiquity_ports.modern_name')
    expect(sql).toContain('antiquity_ports.country')
    expect(sql).toContain('antiquity_ports.foundation')
    expect(sql).toContain('antiquity_ports.pleiades_url')
    expect(sql).toContain('antiquity_ports.wikipedia_url')
  })

  it('draws one point layer, unsimplified — there is nothing to thin at ~6,000 rows', () => {
    const sql = buildPortTileSql(tile)
    expect(sql).toContain("'ports'")
    expect(sql).not.toContain('ST_Simplify')
  })
})
