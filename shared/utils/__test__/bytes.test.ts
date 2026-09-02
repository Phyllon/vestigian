import { describe, expect, it } from 'vitest'
import { formatBytes } from '../bytes'

describe('formatBytes', () => {
  it('renders small counts in megabytes', () => {
    expect(formatBytes(3_400_000, 'en')).toBe('3.4 MB')
  })

  it('switches to gigabytes at 1000 MB', () => {
    expect(formatBytes(1_500_000_000, 'en')).toBe('1.5 GB')
  })

  it('drops the decimal once the number is large enough to not need one', () => {
    expect(formatBytes(42_000_000, 'en')).toBe('42 MB')
  })

  it('formats in another locale’s convention', () => {
    // German uses a comma for the decimal separator.
    expect(formatBytes(3_400_000, 'de')).toContain(',4')
  })
})
