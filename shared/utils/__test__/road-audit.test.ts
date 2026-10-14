import { describe, expect, it } from 'vitest'
import {
  ROAD_AUDIT_STEEP_GRADIENT_PERCENT,
  compareForAuditList,
  countFindsNearRoad,
  isSteepStretch,
  isSupportedByFinds,
  percentileOf,
  summariseRoadAudit,
  type RankableRoadSegment,
  type RoadAuditEvidence,
} from '../road-audit'

const evidence = (overrides: Partial<RoadAuditEvidence> = {}): RoadAuditEvidence => ({
  edhMilestones: 0,
  viciMilestones: 0,
  viciRoadSites: 0,
  certainEnds: 0,
  steepestGradientPercent: 4,
  ...overrides,
})

const segment = (overrides: Partial<RankableRoadSegment> = {}): RankableRoadSegment => ({
  certainty: 'conjectured',
  lengthMetres: 5000,
  evidence: evidence(),
  ...overrides,
})

describe('support', () => {
  it('counts finds from every source and nothing else', () => {
    const counted = evidence({
      edhMilestones: 1,
      viciMilestones: 2,
      viciRoadSites: 3,
      certainEnds: 2,
    })
    expect(countFindsNearRoad(counted)).toBe(6)
  })

  it('does not treat a surveyed neighbour as a find', () => {
    expect(isSupportedByFinds(evidence({ certainEnds: 2 }))).toBe(false)
    expect(isSupportedByFinds(evidence({ viciRoadSites: 1 }))).toBe(true)
  })
})

describe('isSteepStretch', () => {
  it('is false where no gradient could be read', () => {
    expect(isSteepStretch(null)).toBe(false)
  })

  it('switches on at the parameter, inclusive', () => {
    expect(isSteepStretch(ROAD_AUDIT_STEEP_GRADIENT_PERCENT)).toBe(true)
    expect(isSteepStretch(ROAD_AUDIT_STEEP_GRADIENT_PERCENT - 0.1)).toBe(false)
  })
})

describe('compareForAuditList', () => {
  it('puts a conjectured road with nothing near it before a supported one', () => {
    const bare = segment()
    const supported = segment({ evidence: evidence({ edhMilestones: 1 }) })
    expect([supported, bare].sort(compareForAuditList)).toEqual([bare, supported])
  })

  it('ranks an unsupported hypothetical road behind an unsupported conjectured one', () => {
    const conjectured = segment({ lengthMetres: 1000 })
    const hypothetical = segment({ certainty: 'hypothetical', lengthMetres: 90000 })
    expect([hypothetical, conjectured].sort(compareForAuditList)).toEqual([
      conjectured,
      hypothetical,
    ])
  })

  it('orders steep stretches by gradient, not length, so the longest is not first for being long', () => {
    const steeperShort = segment({
      lengthMetres: 3000,
      evidence: evidence({ steepestGradientPercent: ROAD_AUDIT_STEEP_GRADIENT_PERCENT + 20 }),
    })
    const steepLong = segment({
      lengthMetres: 90000,
      evidence: evidence({ steepestGradientPercent: ROAD_AUDIT_STEEP_GRADIENT_PERCENT + 2 }),
    })
    expect([steepLong, steeperShort].sort(compareForAuditList)).toEqual([steeperShort, steepLong])
  })

  it('puts the steep stretch first within a tier, then the longer segment', () => {
    const flatLong = segment({ lengthMetres: 20000 })
    const flatShort = segment({ lengthMetres: 2000 })
    const steepShort = segment({
      lengthMetres: 500,
      evidence: evidence({ steepestGradientPercent: ROAD_AUDIT_STEEP_GRADIENT_PERCENT + 5 }),
    })
    expect([flatShort, flatLong, steepShort].sort(compareForAuditList)).toEqual([
      steepShort,
      flatLong,
      flatShort,
    ])
  })
})

describe('summariseRoadAudit', () => {
  it('counts each reading once, and the overlap of two', () => {
    const totals = summariseRoadAudit([
      { evidence: evidence({ edhMilestones: 1 }) },
      { evidence: evidence({ steepestGradientPercent: ROAD_AUDIT_STEEP_GRADIENT_PERCENT + 5 }) },
      {
        evidence: evidence({
          viciMilestones: 1,
          steepestGradientPercent: ROAD_AUDIT_STEEP_GRADIENT_PERCENT + 1,
        }),
      },
      { evidence: evidence({ steepestGradientPercent: null }) },
    ])
    expect(totals).toEqual({
      segments: 4,
      supported: 2,
      unsupported: 2,
      steep: 2,
      steepAndUnsupported: 1,
      withoutGradient: 1,
    })
  })
})

describe('percentileOf', () => {
  it('reads nearest rank', () => {
    expect(percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
    expect(percentileOf([5], 0.99)).toBe(5)
  })

  it('has no answer for nothing', () => {
    expect(percentileOf([], 0.5)).toBeNull()
  })
})
