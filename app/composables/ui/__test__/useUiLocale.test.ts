import { describe, expect, it } from 'vitest'
import { resolveLocaleName } from '../useUiLocale'

const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'nl', name: 'Nederlands' },
]

describe('resolveLocaleName', () => {
  it('finds the display name for a known locale', () => {
    expect(resolveLocaleName(LOCALES, 'fr')).toBe('Français')
  })

  it('falls back to the code itself for an unknown locale', () => {
    expect(resolveLocaleName(LOCALES, 'ja')).toBe('ja')
  })
})
