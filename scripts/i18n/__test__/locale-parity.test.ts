import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { flatten } from '../translate-locales'

/**
 * Locales are translated by hand, one key at a time, so the realistic failure
 * is a key added to `en.json` and forgotten in one of the other five — it then
 * silently renders in English. Placeholders are checked too: a translation
 * that drops or renames `{count}` renders literally or throws at runtime.
 */
const SOURCE_LOCALE = 'en'
const TRANSLATED_LOCALES = ['fr', 'es', 'de', 'it', 'nl']

const readLocale = (locale: string): Record<string, string> =>
  flatten(
    JSON.parse(
      readFileSync(new URL(`../../../i18n/locales/${locale}.json`, import.meta.url), 'utf8'),
    ),
  )

const placeholdersOf = (message: string): string[] =>
  [...message.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1] ?? '')
    .sort((a, b) => a.localeCompare(b))

const source = readLocale(SOURCE_LOCALE)

describe.each(TRANSLATED_LOCALES)('%s locale', (locale) => {
  const translated = readLocale(locale)

  it('has every key en.json has, and no others', () => {
    const missing = Object.keys(source).filter((key) => !(key in translated))
    const extra = Object.keys(translated).filter((key) => !(key in source))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('keeps the placeholders of the English message', () => {
    const mismatched = Object.keys(source)
      .filter((key) => typeof translated[key] === 'string')
      .filter(
        (key) =>
          placeholdersOf(String(source[key])).join() !==
          placeholdersOf(String(translated[key])).join(),
      )
    expect(mismatched).toEqual([])
  })
})
