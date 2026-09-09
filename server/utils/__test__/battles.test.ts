import { describe, expect, it } from 'vitest'
import { buildBattleCacheKey, buildBattleTileSql } from '../battles'

const tile = { z: 8, x: 134, y: 86 }

describe('buildBattleCacheKey', () => {
  it('rides the atlas generation rather than a third counter of its own', () => {
    expect(buildBattleCacheKey(tile, 3)).toBe('battle:v3:8:134:86')
    expect(buildBattleCacheKey(tile, 4)).not.toBe(buildBattleCacheKey(tile, 3))
  })
})

describe('buildBattleTileSql', () => {
  it('filters in 4326 against the transformed envelope, never the other way round', () => {
    // The rule from atlas.ts/limes.ts: `geom && b.env_wgs` uses the GiST
    // index, `ST_Transform(geom, 3857) && env` cannot.
    const sql = buildBattleTileSql(tile)
    expect(sql).toContain('antiquity_battles.geom && b.env_wgs')
    expect(sql).not.toMatch(/ST_Transform\(antiquity_battles\.geom, 3857\)\s*&&/)
  })

  it('carries what the popup needs and nothing more', () => {
    const sql = buildBattleTileSql(tile)
    expect(sql).toContain('antiquity_battles.title')
    expect(sql).toContain('antiquity_battles.year')
    expect(sql).toContain('antiquity_battles.wikidata_id')
    expect(sql).toContain('antiquity_battles.location_precision')
    expect(sql).toContain('antiquity_battles.wikipedia_url')
  })

  it('draws one point layer, unsimplified — there is nothing to thin at ~490 rows', () => {
    const sql = buildBattleTileSql(tile)
    expect(sql).toContain("'battles'")
    expect(sql).not.toContain('ST_Simplify')
  })
})
