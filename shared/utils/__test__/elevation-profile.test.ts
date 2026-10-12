import { describe, expect, it } from 'vitest'
import {
  ASCENT_NOISE_FLOOR_METRES,
  fillElevationGaps,
  samplePolyline,
  summariseElevationProfile,
} from '../elevation-profile'

/** A line due north from 50°N, about `metres` long. */
const northwards = (metres: number): [number, number][] => [
  [8, 50],
  [8, 50 + metres / 111_195],
]

describe('walking a line', () => {
  it('samples a straight kilometre at the spacing asked for, ends included', () => {
    const { samples, lengthMetres, breaks } = samplePolyline({
      parts: [northwards(1_000)],
      minimumStepMetres: 100,
      maximumSamples: 600,
    })

    expect(lengthMetres).toBeCloseTo(1_000, 0)
    expect(breaks).toEqual([])
    expect(samples).toHaveLength(11)
    expect(samples[0]!.distanceMetres).toBe(0)
    expect(samples[10]!.distanceMetres).toBeCloseTo(1_000, 0)
  })

  it('coarsens the spacing for a long line rather than exceeding the sample budget', () => {
    const { samples } = samplePolyline({
      parts: [northwards(200_000)],
      minimumStepMetres: 25,
      maximumSamples: 400,
    })
    expect(samples.length).toBeLessThanOrEqual(401)
    expect(samples.length).toBeGreaterThan(300)
  })

  it('joins parts end to end and says where each further part begins', () => {
    const { samples, breaks, lengthMetres } = samplePolyline({
      parts: [northwards(500), northwards(500)],
      minimumStepMetres: 100,
      maximumSamples: 600,
    })

    expect(lengthMetres).toBeCloseTo(1_000, 0)
    expect(breaks).toHaveLength(1)
    // Distance carries on across the join: a gap is not measured as ground.
    expect(samples[breaks[0]!]!.distanceMetres).toBeCloseTo(500, 0)
    expect(samples[samples.length - 1]!.distanceMetres).toBeCloseTo(1_000, 0)
  })
})

describe('missing readings', () => {
  it('interpolates a gap between two present values and reports the share present', () => {
    const { elevations, coverage } = fillElevationGaps([100, null, null, 400])
    expect(elevations).toEqual([100, 200, 300, 400])
    expect(coverage).toBe(0.5)
  })

  it('holds the nearest value at an end rather than inventing a slope', () => {
    expect(fillElevationGaps([null, 50, 60, null]).elevations).toEqual([50, 50, 60, 60])
  })

  it('has nothing to say when every reading is missing', () => {
    expect(fillElevationGaps([null, null]).coverage).toBe(0)
  })
})

describe('reading a profile', () => {
  const evenly = (count: number, spacing: number): number[] =>
    Array.from({ length: count }, (_value, index) => index * spacing)

  it('adds up a climb and a descent', () => {
    const distances = evenly(5, 200)
    const stats = summariseElevationProfile({ distances, elevations: [100, 140, 180, 120, 60] })
    expect(stats.ascentMetres).toBe(80)
    expect(stats.descentMetres).toBe(120)
    expect(stats.startMetres).toBe(100)
    expect(stats.endMetres).toBe(60)
    expect(stats.highest).toEqual({ metres: 180, atMetres: 400 })
    expect(stats.lowest).toEqual({ metres: 60, atMetres: 800 })
  })

  it('does not turn terrain noise into a hill', () => {
    // A flat road read as ±1 m wobble: under the noise floor, so no climb at all.
    const elevations = Array.from({ length: 40 }, (_value, index) => 200 + (index % 2))
    const stats = summariseElevationProfile({ distances: evenly(40, 30), elevations })
    expect(ASCENT_NOISE_FLOOR_METRES).toBeGreaterThan(1)
    expect(stats.ascentMetres).toBe(0)
    expect(stats.descentMetres).toBe(0)
  })

  it('states the average slope signed, downhill negative', () => {
    const stats = summariseElevationProfile({
      distances: [0, 1_000, 2_000],
      elevations: [300, 250, 200],
    })
    expect(stats.averageGradientPercent).toBe(-5)
  })

  it('finds the steepest stretch of at least the window, with its sign and place', () => {
    // Flat, then a 10% climb over 300 m, then flat.
    const distances = evenly(11, 100)
    const elevations = [100, 100, 100, 110, 120, 130, 130, 130, 130, 130, 130]
    const stats = summariseElevationProfile({ distances, elevations, gradientWindowMetres: 300 })

    expect(stats.steepestGradientPercent).toBe(10)
    expect(stats.steepestAtMetres).toBeGreaterThanOrEqual(300)
    expect(stats.steepestAtMetres).toBeLessThanOrEqual(450)
  })

  it('widens the gradient window to the sample spacing on a long, coarsely sampled line', () => {
    // 1.7 km between samples: a 150 m window would be a claim about ground never read.
    const stats = summariseElevationProfile({
      distances: [0, 1_700, 3_400, 5_100],
      elevations: [10, 20, 15, 40],
    })
    expect(stats.gradientWindowMetres).toBe(1_700)
  })

  it('copes with a line that has one point', () => {
    const stats = summariseElevationProfile({ distances: [0], elevations: [42] })
    expect(stats.lengthMetres).toBe(0)
    expect(stats.averageGradientPercent).toBe(0)
    expect(stats.highest.metres).toBe(42)
  })
})
