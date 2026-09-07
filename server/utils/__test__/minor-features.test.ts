import { describe, expect, it } from 'vitest'
import { buildMinorFeatureCacheKey, buildMinorFeatureTileSql } from '../minor-features'

const tile = { z: 8, x: 134, y: 86 }

describe('buildMinorFeatureCacheKey', () => {
  it('rides the atlas generation rather than a third counter of its own', () => {
    expect(buildMinorFeatureCacheKey(tile, 3)).toBe('feature:v3:8:134:86')
    expect(buildMinorFeatureCacheKey(tile, 4)).not.toBe(buildMinorFeatureCacheKey(tile, 3))
  })
})

describe('buildMinorFeatureTileSql', () => {
  it('filters in 4326 against the transformed envelope, never the other way round', () => {
    const sql = buildMinorFeatureTileSql(tile)
    expect(sql).toContain('antiquity_features.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\(antiquity_features\.geom, 3857\)\s*&&/)
  })

  it('carries what the popup needs and nothing more', () => {
    const sql = buildMinorFeatureTileSql(tile)
    expect(sql).toContain('antiquity_features.kind')
    expect(sql).toContain('antiquity_features.name')
    expect(sql).toContain('antiquity_features.source')
    expect(sql).toContain('antiquity_features.material')
    expect(sql).toContain('antiquity_features.periods')
  })

  it('draws one point layer, unsimplified — there is nothing to thin at ~525 rows', () => {
    const sql = buildMinorFeatureTileSql(tile)
    expect(sql).toContain("'features'")
    expect(sql).not.toContain('ST_Simplify')
  })
})
