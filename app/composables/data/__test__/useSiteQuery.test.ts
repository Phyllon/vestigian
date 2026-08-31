import { describe, expect, it } from 'vitest'
import { formatPeriod } from '../useSiteQuery'

/** Mirrors the `periodFormat.*` keys in `i18n/locales/en.json`, without loading vue-i18n. */
const t = (key: string, params: Record<string, unknown> = {}): string => {
  const templates: Record<string, string> = {
    'periodFormat.bc': '{year} BC',
    'periodFormat.ad': 'AD {year}',
    'periodFormat.undated': 'Undated',
    'periodFormat.fromYear': 'From {year}',
    'periodFormat.untilYear': 'Until {year}',
    'periodFormat.yearRange': '{from} – {to}',
  }
  return templates[key]!.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
}

describe('formatPeriod', () => {
  it('labels a range that crosses the era boundary', () => {
    expect(formatPeriod(-27, 476, t)).toBe('27 BC – AD 476')
  })

  it('handles a range entirely before the common era', () => {
    expect(formatPeriod(-509, -27, t)).toBe('509 BC – 27 BC')
  })

  it('collapses an identical start and end to a single year', () => {
    expect(formatPeriod(79, 79, t)).toBe('AD 79')
  })

  it('reports open-ended ranges from either side', () => {
    expect(formatPeriod(-146, null, t)).toBe('From 146 BC')
    expect(formatPeriod(null, 410, t)).toBe('Until AD 410')
  })

  it('says undated rather than showing an empty range', () => {
    expect(formatPeriod(null, null, t)).toBe('Undated')
  })
})
