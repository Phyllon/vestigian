import { describe, expect, it } from 'vitest'
import type { BoundingBox } from '../../types'
import {
  LIMES_MARKS,
  LIMES_SECTORS,
  buildMilitaryFeatureTypePattern,
  buildPleiadesMarkSql,
  claimLimesSectors,
  findLimesSector,
  resolveLimesMark,
} from '../limes'

describe('resolveLimesMark', () => {
  it("prefers vici's own word over anything Pleiades says", () => {
    // The contributed record is the more specific claim: someone stood there.
    expect(resolveLimesMark({ subcategory: 'watchtower', featureTypes: 'fort,settlement' })).toBe(
      'watchtower',
    )
  })

  it('reads the three vici kinds that survive the fortification category', () => {
    expect(resolveLimesMark({ subcategory: 'watchtower' })).toBe('watchtower')
    expect(resolveLimesMark({ subcategory: 'fort' })).toBe('fort')
    expect(resolveLimesMark({ subcategory: 'camp' })).toBe('camp')
  })

  it('takes the first Pleiades term that maps, not the last', () => {
    // Pleiades writes the defining type first and qualifies it after, which is
    // what makes "fort, tower-defensive" a fort rather than a tower.
    expect(resolveLimesMark({ featureTypes: 'fort,tower-defensive' })).toBe('fort')
    expect(resolveLimesMark({ featureTypes: 'tower-defensive,fort' })).toBe('watchtower')
  })

  it('strips the ordinal suffix Pleiades disambiguates with', () => {
    // `fort-2` is the second sense of "fort" in their vocabulary, not a
    // different kind of thing.
    expect(resolveLimesMark({ featureTypes: 'fort-2' })).toBe('fort')
  })

  it('returns null for a frontier feature that is not a post on it', () => {
    // A length of wall belongs in the roll and has no business being drawn as a
    // fort-shaped mark on the line it is part of.
    expect(resolveLimesMark({ featureTypes: 'defensive-wall' })).toBeNull()
    expect(resolveLimesMark({ featureTypes: 'frontier-system-limes' })).toBeNull()
    expect(resolveLimesMark({})).toBeNull()
  })

  it('never invents a mark from an unrelated category', () => {
    expect(resolveLimesMark({ subcategory: 'villa', featureTypes: 'temple' })).toBeNull()
  })
})

describe('buildMilitaryFeatureTypePattern', () => {
  const matches = (featureTypes: string): boolean =>
    new RegExp(buildMilitaryFeatureTypePattern()).test(featureTypes)

  it('matches a term anywhere in the comma-separated list', () => {
    expect(matches('fort')).toBe(true)
    expect(matches('settlement,fort')).toBe(true)
    expect(matches('settlement, fort, bath')).toBe(true)
  })

  it('does not match a term that merely starts with one', () => {
    // The whole reason for the anchors: `fort` must not swallow `fortification`
    // or `fortified-church`, which are different claims.
    expect(matches('fortified-church')).toBe(false)
    expect(matches('fortuna-sanctuary')).toBe(false)
  })

  it('still matches the ordinal forms Pleiades publishes', () => {
    expect(matches('fort-2')).toBe(true)
  })

  it('leaves a place with no military type alone', () => {
    expect(matches('settlement,bath,theatre')).toBe(false)
  })
})

describe('buildPleiadesMarkSql', () => {
  it('generates a branch for every term the TypeScript mapping knows', () => {
    // The whole point of generating it: the mark a tile draws and the mark the
    // roll lists come from one table, so they cannot drift.
    const sql = buildPleiadesMarkSql('ft')
    for (const mark of LIMES_MARKS) expect(sql).toContain(`THEN '${mark}'`)
    expect(sql).toContain('tower-defensive')
    expect(sql).toMatch(/^CASE /)
    expect(sql).toMatch(/ ELSE NULL END$/)
  })

  it('emits nothing that could close a SQL string literal', () => {
    // It is interpolated into a statement handed to `sql.unsafe`. The terms are
    // fixed identifiers, and this is the assertion that keeps them that way.
    expect(buildPleiadesMarkSql('ft').split("'").length % 2).toBe(1)
  })
})

describe('the gazetteer', () => {
  it('has a unique slug per sector', () => {
    const slugs = LIMES_SECTORS.map((sector) => sector.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('gives every sector bounds that are the right way round', () => {
    for (const sector of LIMES_SECTORS) {
      expect(sector.bounds.east).toBeGreaterThan(sector.bounds.west)
      expect(sector.bounds.north).toBeGreaterThan(sector.bounds.south)
    }
  })

  it('finds a sector by slug', () => {
    expect(findLimesSector('hadrians-wall')?.name).toBe("Hadrian's Wall")
    expect(findLimesSector('no-such-frontier')).toBeUndefined()
  })
})

describe('claimLimesSectors', () => {
  const first = (kind: 'barrier' | 'river' | 'notional', bounds: BoundingBox) =>
    claimLimesSectors({ kind, bounds })[0]?.sector.slug

  const hadriansWall = { west: -2.6, south: 54.9, east: -2.2, north: 55.1 }

  it('claims a stretch whose bounds overlap a sector', () => {
    expect(first('barrier', hadriansWall)).toBe('hadrians-wall')
  })

  it('will not give a river stretch to a barrier-only sector', () => {
    /**
     * This is the rule that keeps the Limes Transalutanus — an earthwork north
     * of the Danube — from swallowing the river frontier running through the
     * same rectangle. Without it the two are indistinguishable by bounds alone.
     */
    const transalutanus = { west: 23.5, south: 43.9, east: 24.5, north: 44.4 }
    expect(first('river', transalutanus)).toBe('danube-limes-moesia')
    expect(first('barrier', transalutanus)).toBe('limes-transalutanus')
  })

  it('divides one long run between every sector it crosses', () => {
    // A single 1,331 km run of Danube crosses Noricum, Pannonia and Moesia.
    // Handing it whole to the first match would file the Hungarian plain under
    // Bulgaria.
    const danube = { west: 12.5, south: 44.5, east: 28, north: 49 }
    const slugs = claimLimesSectors({ kind: 'river', bounds: danube }).map(
      (claim) => claim.sector.slug,
    )
    expect(slugs).toContain('danube-limes-noricum-pannonia')
    expect(slugs).toContain('danube-limes-moesia')
  })

  it('tells a later sector to subtract every earlier one that could share ground', () => {
    /**
     * The Dacian salient and the Moesian Danube overlap around 45.3 N. Before
     * this, 209 km of frontier was in the database twice — drawn twice and
     * counted twice in two sectors' lengths.
     */
    const overlapping = { west: 21, south: 44, east: 26, north: 47 }
    const claims = claimLimesSectors({ kind: 'notional', bounds: overlapping })

    const dacia = claims.findIndex((claim) => claim.sector.slug === 'limes-daciae')
    const moesia = claims.findIndex((claim) => claim.sector.slug === 'danube-limes-moesia')
    expect(dacia).toBeGreaterThanOrEqual(0)
    expect(moesia).toBeGreaterThan(dacia)

    // The earlier one subtracts nothing of the later; the later subtracts it.
    expect(claims[dacia]!.excludes).not.toContainEqual(claims[moesia]!.sector.bounds)
    expect(claims[moesia]!.excludes).toContainEqual(claims[dacia]!.sector.bounds)
  })

  it('claims nothing outside every sector', () => {
    // The southern Egyptian desert edge, which is 2,200 km of provincial
    // boundary and not a frontier system. Left undrawn on purpose.
    expect(
      claimLimesSectors({ kind: 'notional', bounds: { west: 25, south: 23, east: 27, north: 24 } }),
    ).toEqual([])
  })
})
