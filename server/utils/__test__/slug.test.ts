import { describe, expect, it } from 'vitest'
import { disambiguateSlug, slugify } from '../slug'

describe('slugify', () => {
  it('folds diacritics rather than dropping the letters', () => {
    expect(slugify('Trajanova Ćuprija')).toBe('trajanova-cuprija')
    expect(slugify('Römerkastell Saalburg')).toBe('romerkastell-saalburg')
    expect(slugify('İznik')).toBe('iznik')
  })

  it('collapses punctuation and trims stray separators', () => {
    expect(slugify('  Villa Rustica (Ahrweiler) — Site 4 ')).toBe(
      'villa-rustica-ahrweiler-site-4',
    )
  })

  it('handles the German sharp s', () => {
    expect(slugify('Kastell Straße')).toBe('kastell-strasse')
  })

  it('never exceeds the column length', () => {
    expect(slugify('a'.repeat(300)).length).toBeLessThanOrEqual(120)
  })
})

describe('disambiguateSlug', () => {
  it('leaves the first attempt untouched', () => {
    expect(disambiguateSlug('fectio', 0)).toBe('fectio')
  })

  it('numbers subsequent attempts from two', () => {
    expect(disambiguateSlug('fectio', 1)).toBe('fectio-2')
  })
})
