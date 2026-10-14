import { describe, expect, it } from 'vitest'
import {
  ROMAN_MILE_METRES,
  measureTabulaLeg,
  romanMilesToMetres,
  SHORTER_THAN_LINE_TOLERANCE,
} from '../tabula-distance'

describe('romanMilesToMetres', () => {
  it('uses the stated mile', () => {
    expect(romanMilesToMetres(10)).toBe(10 * ROMAN_MILE_METRES)
  })
})

describe('measureTabulaLeg', () => {
  it('has nothing to say about a leg without a figure', () => {
    expect(measureTabulaLeg({ statedRomanMiles: null, straightLineMetres: 20000 })).toBeNull()
  })

  it('refuses a zero figure and two places on one point rather than dividing by zero', () => {
    expect(measureTabulaLeg({ statedRomanMiles: 0, straightLineMetres: 20000 })).toBeNull()
    expect(measureTabulaLeg({ statedRomanMiles: 12, straightLineMetres: 0 })).toBeNull()
  })

  it('reads a figure over the line as the ordinary case', () => {
    const measure = measureTabulaLeg({ statedRomanMiles: 16, straightLineMetres: 20000 })
    expect(measure?.statedMetres).toBe(23680)
    expect(measure?.statedOverLine).toBeCloseTo(1.184, 3)
    expect(measure?.reading).toBe('at-or-over-line')
  })

  it('flags a figure clearly under the line', () => {
    const measure = measureTabulaLeg({ statedRomanMiles: 10, straightLineMetres: 20000 })
    expect(measure?.reading).toBe('shorter-than-line')
  })

  it('lets a figure a hair under the line pass, inside the tolerance', () => {
    const lineMetres = 20000
    const justUnder = (lineMetres * (1 - SHORTER_THAN_LINE_TOLERANCE / 2)) / ROMAN_MILE_METRES
    expect(
      measureTabulaLeg({ statedRomanMiles: justUnder, straightLineMetres: lineMetres })?.reading,
    ).toBe('at-or-over-line')
  })
})
