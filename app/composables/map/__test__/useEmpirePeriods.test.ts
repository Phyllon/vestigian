import { describe, expect, it } from 'vitest'
import { formatPeriodYear } from '../useEmpirePeriods'

const translate = (key: string, named: Record<string, unknown>): string =>
  key === 'periodSwitcher.yearBce' ? `${named.year} BCE` : `${named.year} CE`

describe('formatPeriodYear', () => {
  it('renders a negative year as a positive BCE count', () => {
    // The source stores traditional counts, so -509 is 509 BCE — printing
    // the sign would read as "minus 509 BCE".
    expect(formatPeriodYear(-509, translate)).toBe('509 BCE')
  })

  it('renders a positive year as CE', () => {
    expect(formatPeriodYear(117, translate)).toBe('117 CE')
  })

  it('asks for the era word rather than concatenating one', () => {
    // BCE/CE notation differs per locale (`v. Chr.`, `av. J.-C.`), so the
    // era has to come from the caller's translator, not from this function.
    const keys: string[] = []
    formatPeriodYear(-44, (key, named) => {
      keys.push(key)
      return String(named.year)
    })
    expect(keys).toEqual(['periodSwitcher.yearBce'])
  })
})
