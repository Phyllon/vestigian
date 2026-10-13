import { describe, expect, it } from 'vitest'
import {
  headingFromOrientation,
  normaliseDegrees,
  shortestAngleDelta,
  smoothHeading,
} from '../compass'

/** How far a reading is from the expected bearing, the short way; Infinity when there is none. */
const bearingError = (actual: number | null, expected: number): number =>
  actual === null ? Number.POSITIVE_INFINITY : Math.abs(shortestAngleDelta(actual, expected))

describe('normaliseDegrees', () => {
  it('wraps into [0, 360)', () => {
    expect(normaliseDegrees(0)).toBe(0)
    expect(normaliseDegrees(360)).toBe(0)
    expect(normaliseDegrees(-90)).toBe(270)
    expect(normaliseDegrees(725)).toBe(5)
  })
})

describe('shortestAngleDelta', () => {
  it('goes the short way across north', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20)
    expect(shortestAngleDelta(10, 350)).toBe(-20)
  })

  it('reports a half turn as +180, not -180', () => {
    expect(shortestAngleDelta(0, 180)).toBe(180)
  })
})

describe('smoothHeading', () => {
  it('starts from the first reading', () => {
    expect(smoothHeading(null, 123, 0.25)).toBe(123)
  })

  it('moves a fraction of the way towards the new reading', () => {
    expect(smoothHeading(100, 140, 0.25)).toBeCloseTo(110, 6)
  })

  it('does not average across north the long way round', () => {
    const smoothed = smoothHeading(350, 10, 0.5)
    expect(bearingError(smoothed, 0)).toBeLessThan(0.001)
  })
})

describe('headingFromOrientation', () => {
  describe('held flat, face up', () => {
    it('reads the way the top edge points', () => {
      expect(bearingError(headingFromOrientation({ alpha: 0, beta: 0, gamma: 0 }), 0)).toBeLessThan(
        0.001,
      )
      // alpha is counter-clockwise: 90 means the top edge has turned to the west.
      expect(
        bearingError(headingFromOrientation({ alpha: 90, beta: 0, gamma: 0 }), 270),
      ).toBeLessThan(0.001)
      expect(
        bearingError(headingFromOrientation({ alpha: 270, beta: 0, gamma: 0 }), 90),
      ).toBeLessThan(0.001)
      expect(
        bearingError(headingFromOrientation({ alpha: 180, beta: 0, gamma: 0 }), 180),
      ).toBeLessThan(0.001)
    })
  })

  describe('held upright in front of the face', () => {
    it('reads the way the back points, not the sky the top edge points at', () => {
      expect(
        bearingError(headingFromOrientation({ alpha: 0, beta: 90, gamma: 0 }), 0),
      ).toBeLessThan(0.001)
      expect(
        bearingError(headingFromOrientation({ alpha: 90, beta: 90, gamma: 0 }), 270),
      ).toBeLessThan(0.001)
      expect(
        bearingError(headingFromOrientation({ alpha: 270, beta: 90, gamma: 0 }), 90),
      ).toBeLessThan(0.001)
    })
  })

  describe('held at a walking tilt', () => {
    it('agrees with both readings at 45 degrees', () => {
      expect(
        bearingError(headingFromOrientation({ alpha: 0, beta: 45, gamma: 0 }), 0),
      ).toBeLessThan(0.001)
      expect(
        bearingError(headingFromOrientation({ alpha: 90, beta: 45, gamma: 0 }), 270),
      ).toBeLessThan(0.001)
    })

    it('does not jump across the point where it changes which edge it reads', () => {
      const before = headingFromOrientation({ alpha: 30, beta: 44, gamma: 0 }) as number
      const after = headingFromOrientation({ alpha: 30, beta: 46, gamma: 0 }) as number
      expect(Math.abs(shortestAngleDelta(before, after))).toBeLessThan(1)
    })
  })

  describe('with the screen turned to landscape', () => {
    it('corrects a flat top-edge reading by the screen angle', () => {
      // The phone is turned a quarter turn to read in landscape, so its top edge
      // now points west (alpha 90) — but the reader is still facing north.
      expect(
        bearingError(headingFromOrientation({ alpha: 90, beta: 0, gamma: 0 }, 90), 0),
      ).toBeLessThan(0.001)
    })

    it('leaves an upright back-facing reading alone', () => {
      expect(
        bearingError(headingFromOrientation({ alpha: 90, beta: 90, gamma: 0 }, 90), 270),
      ).toBeLessThan(0.001)
    })
  })

  describe('with an incomplete reading', () => {
    it('answers null rather than a guess', () => {
      expect(headingFromOrientation({ alpha: null, beta: 0, gamma: 0 })).toBeNull()
      expect(headingFromOrientation({ alpha: 0, beta: null, gamma: 0 })).toBeNull()
      expect(headingFromOrientation({ alpha: 0, beta: 0, gamma: null })).toBeNull()
      expect(headingFromOrientation({ alpha: Number.NaN, beta: 0, gamma: 0 })).toBeNull()
    })
  })
})
