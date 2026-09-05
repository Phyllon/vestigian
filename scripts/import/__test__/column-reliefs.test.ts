import { describe, expect, it } from 'vitest'
import { parseSceneNumber, parseSortOrder, romanToArabic } from '../11-column-reliefs'

describe('romanToArabic', () => {
  it('reads simple additive numerals', () => {
    expect(romanToArabic('III')).toBe(3)
    expect(romanToArabic('VIII')).toBe(8)
  })

  it('reads subtractive pairs', () => {
    expect(romanToArabic('IV')).toBe(4)
    expect(romanToArabic('IX')).toBe(9)
    expect(romanToArabic('XL')).toBe(40)
    expect(romanToArabic('XCIX')).toBe(99)
  })

  it("reads the Cichorius plates' full range, including the largest (LVII)", () => {
    expect(romanToArabic('I')).toBe(1)
    expect(romanToArabic('LVII')).toBe(57)
  })

  it('rejects anything that is not a Roman numeral', () => {
    expect(romanToArabic('')).toBeNull()
    expect(romanToArabic('MMXXV')).toBe(2025)
    expect(romanToArabic('IIII2')).toBeNull()
    expect(romanToArabic('ABC')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(romanToArabic('xxviii')).toBe(28)
  })
})

describe('parseSceneNumber', () => {
  it('extracts the Tafel number from a real Commons title', () => {
    expect(
      parseSceneNumber('File:028 Conrad Cichorius, Die Reliefs der Traianssäule, Tafel XXVIII.jpg'),
    ).toBe(28)
  })

  it('extracts the Tafel number even from a cropped detail title', () => {
    expect(
      parseSceneNumber(
        'File:072 Conrad Cichorius, Die Reliefs der Traianssäule, Tafel LXXII (Ausschnitt 01).jpg',
      ),
    ).toBe(72)
  })

  it('returns null rather than guessing when no Tafel number is present', () => {
    expect(parseSceneNumber('File:Trajans Column, overview.jpg')).toBeNull()
  })
})

describe('parseSortOrder', () => {
  it('reads the zero-padded file-sequence prefix', () => {
    expect(
      parseSortOrder('File:028 Conrad Cichorius, Die Reliefs der Traianssäule, Tafel XXVIII.jpg'),
    ).toBe(28)
    expect(
      parseSortOrder('File:081 Conrad Cichorius, Die Reliefs der Traianssäule, Tafel LXXXI.jpg'),
    ).toBe(81)
  })

  it('falls back to 0 when the title carries no numeric prefix', () => {
    expect(parseSortOrder("File:Trajan's Column, overview.jpg")).toBe(0)
  })
})
