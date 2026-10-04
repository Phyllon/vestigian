import { describe, expect, it } from 'vitest'
import {
  ROAD_SECONDARY_MINIMUM_ZOOM,
  buildPolityCacheKey,
  buildPolityTileSql,
  buildReferenceCacheKey,
  buildReferenceTileSql,
  isReferenceLayerId,
} from '../reference-layers'

const tile = { z: 8, x: 134, y: 86 }

describe('isReferenceLayerId', () => {
  it('accepts the four layers and nothing else', () => {
    for (const id of ['roman-roads', 'mints', 'monuments', 'isicily', 'hillforts']) {
      expect(isReferenceLayerId(id)).toBe(true)
    }
    // The path segment is user input; it must never reach a table name unchecked.
    for (const id of ['', 'sites', 'mints; DROP TABLE sites', '../roads', 'polities']) {
      expect(isReferenceLayerId(id)).toBe(false)
    }
  })
})

describe('buildReferenceCacheKey', () => {
  it('is keyed by layer and rides the atlas generation', () => {
    expect(buildReferenceCacheKey('mints', tile, 3)).toBe('reference:mints:v3:8:134:86')
    expect(buildReferenceCacheKey('mints', tile, 4)).not.toBe(
      buildReferenceCacheKey('mints', tile, 3),
    )
    // `refreshAtlasCache(['reference:mints:*'])` must not catch another layer's tiles.
    expect(buildReferenceCacheKey('monuments', tile, 3)).not.toMatch(/^reference:mints:/)
  })

  it('puts the year in a polity key, so each year is its own tile', () => {
    expect(buildPolityCacheKey(tile, 3, -264)).toBe('reference:polities:v3:-264:8:134:86')
    expect(buildPolityCacheKey(tile, 3, -264)).not.toBe(buildPolityCacheKey(tile, 3, -263))
  })
})

describe('buildReferenceTileSql', () => {
  const sqlFor = (layer: Parameters<typeof buildReferenceTileSql>[0]['layer'], z = 8) =>
    buildReferenceTileSql({ layer, tile: { ...tile, z }, simplifyTolerance: 100 })

  it('filters every layer in 4326 against the transformed envelope, never the other way round', () => {
    expect(sqlFor('mints')).toContain('antiquity_mints.geom && b.env_wgs')
    expect(sqlFor('monuments')).toContain('antiquity_monuments.geom && b.env_wgs')
    expect(sqlFor('isicily')).toContain('isicily_inscriptions.geom && b.env_wgs')
    expect(sqlFor('roman-roads')).toContain('antiquity_roman_roads.geom && b.env_wgs')
    expect(sqlFor('hillforts')).toContain('antiquity_hillforts.geom && b.env_wgs')
    expect(sqlFor('mints')).not.toMatch(/ST_Transform\(antiquity_mints\.geom, 3857\)\s*&&/)
  })

  it('names each source layer for the style that reads it', () => {
    expect(sqlFor('roman-roads')).toContain("'roman_roads'")
    expect(sqlFor('mints')).toContain("'mints'")
    expect(sqlFor('monuments')).toContain("'monuments'")
    expect(sqlFor('isicily')).toContain("'isicily'")
    expect(sqlFor('hillforts')).toContain("'hillforts'")
  })

  it('draws only main roads below the secondary-road zoom, then everything', () => {
    expect(sqlFor('roman-roads', ROAD_SECONDARY_MINIMUM_ZOOM - 1)).toContain(
      'AND antiquity_roman_roads.is_main',
    )
    expect(sqlFor('roman-roads', ROAD_SECONDARY_MINIMUM_ZOOM)).not.toContain(
      'AND antiquity_roman_roads.is_main',
    )
  })

  it('simplifies roads by the tolerance it is given and leaves points alone', () => {
    expect(sqlFor('roman-roads')).toContain(
      'ST_Simplify(ST_Transform(antiquity_roman_roads.geom, 3857), 100)',
    )
    expect(sqlFor('mints')).not.toContain('ST_Simplify')
  })

  it('sends hillfort arrays as comma-joined strings, and never selects free text', () => {
    // An MVT property cannot be an array; and the atlas's 1 KB summaries must not reach a tile.
    expect(sqlFor('hillforts')).toContain("array_to_string(antiquity_hillforts.types, ',')")
    expect(sqlFor('hillforts')).toContain("array_to_string(antiquity_hillforts.dated_periods, ',')")
    expect(sqlFor('hillforts')).not.toContain('summary')
  })

  it('skips an inscription with no position rather than placing it at 0,0', () => {
    expect(sqlFor('isicily')).toContain('isicily_inscriptions.geom IS NOT NULL')
  })

  it('links an I.Sicily mark by its stable identifier, not the serial id', () => {
    expect(sqlFor('isicily')).toContain('isicily_inscriptions.isicily_id')
  })
})

describe('buildPolityTileSql', () => {
  const sql = buildPolityTileSql({ tile, year: -264, simplifyTolerance: 250 })

  it('treats a slice as inclusive at both ends, as Cliopatria defines it', () => {
    expect(sql).toContain('antiquity_polities.from_year <= -264')
    expect(sql).toContain('antiquity_polities.to_year >= -264')
  })

  it('cuts each realm by the Roman extent of the same year, so the two sources never double-draw', () => {
    expect(sql).toContain('ST_Difference(')
    expect(sql).toContain('FROM antiquity_empire_extents e')
    // OHM's extents are half-open, like the empire tile endpoint reads them.
    expect(sql).toContain('e.start_year <= -264')
    expect(sql).toContain('e.end_year > -264')
  })

  it('simplifies the Roman side before validating it, which is what keeps a continental tile fast', () => {
    const simplified = sql.indexOf('ST_Simplify(e.geom')
    const validated = sql.indexOf('ST_MakeValid(ST_Simplify(e.geom')
    expect(simplified).toBeGreaterThan(-1)
    // Validating an 83,000-vertex polygon first cost ~2 s a tile; it must wrap the simplified one.
    expect(validated).toBeGreaterThan(-1)
    expect(sql).not.toMatch(/ST_Simplify\(ST_MakeValid\(e\.geom/)
  })

  it('opens away the coastal slivers the cut leaves, by a negative then a positive buffer', () => {
    // ~2 px each way at this tolerance; without it every coast carries a labelled strip of sea.
    expect(sql).toMatch(/ST_Buffer\(\s*ST_Buffer\(/)
    expect(sql).toContain('-500')
    expect(sql).toContain('500\n')
  })

  it('still draws a realm when there is no Roman extent in the tile', () => {
    expect(sql).toContain(
      'CASE WHEN rome.geom IS NULL THEN ST_Transform(antiquity_polities.geom, 3857)',
    )
  })

  it('draws the largest realm first so a small one is not hidden under it', () => {
    expect(sql).toContain('ORDER BY antiquity_polities.area_square_kilometres DESC')
  })

  it('carries what the label popup needs', () => {
    for (const column of ['name', 'from_year', 'to_year', 'wikidata_id', 'wikipedia_title']) {
      expect(sql).toContain(`antiquity_polities.${column}`)
    }
  })
})
