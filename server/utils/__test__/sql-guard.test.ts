import { describe, expect, it } from 'vitest'
import { buildAtlasTileSql, buildEmpireExtentTileSql, planAtlasRender } from '../atlas'
import { buildAtticInscriptionTileSql } from '../attic-inscriptions'
import { buildBattleTileSql } from '../battles'
import { buildCoinHoardTileSql } from '../coin-hoards'
import { buildInscriptionTileSql } from '../inscriptions'
import { buildLimesTileSql, planLimesRender } from '../limes'
import { buildMinorFeatureTileSql } from '../minor-features'
import { buildClusterTileSql, buildFeatureTileSql } from '../mvt'
import { buildRouteTileSql } from '../orbis-routes'
import { buildPortTileSql } from '../ports'
import { buildPolityTileSql, buildReferenceTileSql } from '../reference-layers'
import { assertFiniteNumber, assertTileCoordinate, buildTileEnvelopeSql } from '../sql-guard'

const tile = { z: 6, x: 33, y: 22 }

// Values that would be legal JavaScript numbers or strings at a call site that
// forgot to validate, and that must never be written into a statement.
const badCoordinates = [
  { z: 1.5, x: 0, y: 0 },
  { z: 1, x: Number.NaN, y: 0 },
  { z: 1, x: 0, y: Number.POSITIVE_INFINITY },
  { z: '1; DROP TABLE sites; --' as unknown as number, x: 0, y: 0 },
]

const badNumbers = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

describe('assertTileCoordinate', () => {
  it('accepts integer coordinates', () => {
    expect(() => assertTileCoordinate(tile)).not.toThrow()
  })

  it.each(badCoordinates)('throws for %j', (bad) => {
    expect(() => assertTileCoordinate(bad)).toThrow(TypeError)
  })
})

describe('assertFiniteNumber', () => {
  it.each([0, -3, 0.5, 1e9])('accepts %s', (value) => {
    expect(() => assertFiniteNumber(value, 'value')).not.toThrow()
  })

  it.each(badNumbers)('throws for %s and names the value', (value) => {
    expect(() => assertFiniteNumber(value, 'gridSize')).toThrow(/gridSize/)
  })

  it('throws for a string that merely looks numeric', () => {
    expect(() => assertFiniteNumber('1' as unknown as number, 'year')).toThrow(TypeError)
  })
})

describe('buildTileEnvelopeSql', () => {
  it('renders the integers verbatim', () => {
    expect(buildTileEnvelopeSql(tile)).toBe('ST_TileEnvelope(6, 33, 22)')
  })

  it.each(badCoordinates)('throws for %j', (bad) => {
    expect(() => buildTileEnvelopeSql(bad)).toThrow(TypeError)
  })
})

describe('every raw-SQL tile builder refuses a non-integer coordinate', () => {
  const atlasPlan = planAtlasRender(8)
  const limesPlan = planLimesRender(8)

  const builders: Record<string, (bad: typeof tile) => string> = {
    buildClusterTileSql: (bad) => buildClusterTileSql({ tile: bad, gridSize: 100000 }),
    buildFeatureTileSql: (bad) =>
      buildFeatureTileSql({
        tile: bad,
        simplifyTolerance: 10,
        includeTracings: true,
        compactSiteProperties: false,
      }),
    buildAtlasTileSql: (bad) => buildAtlasTileSql({ tile: bad, plan: atlasPlan }),
    buildEmpireExtentTileSql: (bad) =>
      buildEmpireExtentTileSql({ tile: bad, year: 100, simplifyTolerance: 10 }),
    buildLimesTileSql: (bad) => buildLimesTileSql({ tile: bad, plan: limesPlan }),
    buildPolityTileSql: (bad) =>
      buildPolityTileSql({ tile: bad, year: 100, simplifyTolerance: 10 }),
    'buildReferenceTileSql (roads)': (bad) =>
      buildReferenceTileSql({ layer: 'roman-roads', tile: bad, simplifyTolerance: 10 }),
    'buildReferenceTileSql (mints)': (bad) =>
      buildReferenceTileSql({ layer: 'mints', tile: bad, simplifyTolerance: 10 }),
    buildPortTileSql,
    buildBattleTileSql,
    buildRouteTileSql,
    buildCoinHoardTileSql,
    buildMinorFeatureTileSql,
    buildInscriptionTileSql,
    buildAtticInscriptionTileSql,
  }

  describe.each(Object.entries(builders))('%s', (_name, build) => {
    it('builds for a valid tile', () => {
      expect(build(tile)).toContain('ST_TileEnvelope(6, 33, 22)')
    })

    it.each(badCoordinates)('throws for %j', (bad) => {
      expect(() => build(bad)).toThrow(TypeError)
    })
  })
})

describe('numeric parameters of the raw-SQL builders', () => {
  it.each(badNumbers)('buildClusterTileSql rejects gridSize %s', (gridSize) => {
    expect(() => buildClusterTileSql({ tile, gridSize })).toThrow(/gridSize/)
  })

  it.each(badNumbers)('buildFeatureTileSql rejects simplifyTolerance %s', (simplifyTolerance) => {
    expect(() =>
      buildFeatureTileSql({
        tile,
        simplifyTolerance,
        includeTracings: false,
        compactSiteProperties: false,
      }),
    ).toThrow(/simplifyTolerance/)
  })

  it.each(badNumbers)('buildEmpireExtentTileSql rejects year %s', (year) => {
    expect(() => buildEmpireExtentTileSql({ tile, year, simplifyTolerance: 10 })).toThrow(/year/)
  })

  it.each(badNumbers)('buildPolityTileSql rejects year %s', (year) => {
    expect(() => buildPolityTileSql({ tile, year, simplifyTolerance: 10 })).toThrow(/year/)
  })

  it.each(badNumbers)('buildPolityTileSql rejects simplifyTolerance %s', (simplifyTolerance) => {
    expect(() => buildPolityTileSql({ tile, year: 100, simplifyTolerance })).toThrow(
      /simplifyTolerance/,
    )
  })

  it.each(badNumbers)('the road layer rejects simplifyTolerance %s', (simplifyTolerance) => {
    expect(() => buildReferenceTileSql({ layer: 'roman-roads', tile, simplifyTolerance })).toThrow(
      /simplifyTolerance/,
    )
  })

  it('the empire extent builder rejects a non-finite tolerance', () => {
    expect(() =>
      buildEmpireExtentTileSql({ tile, year: 100, simplifyTolerance: Number.NaN }),
    ).toThrow(/simplifyTolerance/)
  })
})
