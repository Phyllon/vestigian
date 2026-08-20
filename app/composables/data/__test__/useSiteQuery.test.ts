import { describe, expect, it } from 'vitest'
import { formatPeriod } from '../useSiteQuery'

describe('formatPeriod', () => {
  it('labels a range that crosses the era boundary', () => {
    expect(formatPeriod(-27, 476)).toBe('27 BC – AD 476')
  })

  it('handles a range entirely before the common era', () => {
    expect(formatPeriod(-509, -27)).toBe('509 BC – 27 BC')
  })

  it('collapses an identical start and end to a single year', () => {
    expect(formatPeriod(79, 79)).toBe('AD 79')
  })

  it('reports open-ended ranges from either side', () => {
    expect(formatPeriod(-146, null)).toBe('From 146 BC')
    expect(formatPeriod(null, 410)).toBe('Until AD 410')
  })

  it('says undated rather than showing an empty range', () => {
    expect(formatPeriod(null, null)).toBe('Undated')
  })
})
