import { describe, expect, it } from 'vitest'
import { buildCoinHoardCacheKey, buildCoinHoardTileSql } from '../coin-hoards'

const tile = { z: 8, x: 134, y: 86 }

describe('buildCoinHoardCacheKey', () => {
  it('rides the atlas generation rather than a third counter of its own', () => {
    expect(buildCoinHoardCacheKey(tile, 3)).toBe('coin-hoard:v3:8:134:86')
    expect(buildCoinHoardCacheKey(tile, 4)).not.toBe(buildCoinHoardCacheKey(tile, 3))
  })
})

describe('buildCoinHoardTileSql', () => {
  it('filters in 4326 against the transformed envelope, never the other way round', () => {
    const sql = buildCoinHoardTileSql(tile)
    expect(sql).toContain('antiquity_coin_hoards.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\(antiquity_coin_hoards\.geom, 3857\)\s*&&/)
  })

  it('carries what the popup needs and nothing more', () => {
    const sql = buildCoinHoardTileSql(tile)
    expect(sql).toContain('antiquity_coin_hoards.name')
    expect(sql).toContain('antiquity_coin_hoards.hoard_count')
    expect(sql).toContain('antiquity_coin_hoards.geonames_url')
  })

  it('draws one point layer, unsimplified — there is nothing to thin at 620 rows', () => {
    const sql = buildCoinHoardTileSql(tile)
    expect(sql).toContain("'coin_hoards'")
    expect(sql).not.toContain('ST_Simplify')
  })
})
