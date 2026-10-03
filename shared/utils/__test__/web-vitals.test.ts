import { describe, expect, it } from 'vitest'
import { MAXIMUM_VITAL_VALUE, VITAL_NAMES, VITAL_THRESHOLDS, rateVital } from '../web-vitals'

describe('rateVital', () => {
  it('uses the published thresholds, inclusive at the boundary', () => {
    expect(rateVital('LCP', 2500)).toBe('good')
    expect(rateVital('LCP', 2501)).toBe('needs-improvement')
    expect(rateVital('LCP', 4000)).toBe('needs-improvement')
    expect(rateVital('LCP', 4001)).toBe('poor')
  })

  it('rates CLS on its own unitless scale', () => {
    expect(rateVital('CLS', 0.05)).toBe('good')
    expect(rateVital('CLS', 0.2)).toBe('needs-improvement')
    expect(rateVital('CLS', 0.3)).toBe('poor')
  })

  it('has a threshold pair and a ceiling for every name', () => {
    for (const name of VITAL_NAMES) {
      expect(VITAL_THRESHOLDS[name].good).toBeLessThan(VITAL_THRESHOLDS[name].poor)
      expect(MAXIMUM_VITAL_VALUE[name]).toBeGreaterThan(VITAL_THRESHOLDS[name].poor)
    }
  })
})
