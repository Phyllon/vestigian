import { describe, expect, it } from 'vitest'
import { flatten, isFrozenKey, splitOnPlaceholders, unflatten } from '../translate-locales'

describe('splitOnPlaceholders', () => {
  it('splits text around a single placeholder', () => {
    expect(splitOnPlaceholders('Select revision {id}')).toEqual([
      { text: 'Select revision ', isPlaceholder: false },
      { text: '{id}', isPlaceholder: true },
    ])
  })

  it('splits text around multiple placeholders, keeping the text between them', () => {
    expect(splitOnPlaceholders('Note to {name}, {count} accepted')).toEqual([
      { text: 'Note to ', isPlaceholder: false },
      { text: '{name}', isPlaceholder: true },
      { text: ', ', isPlaceholder: false },
      { text: '{count}', isPlaceholder: true },
      { text: ' accepted', isPlaceholder: false },
    ])
  })

  it('handles a placeholder at the very start or end', () => {
    expect(splitOnPlaceholders('{count} accepted')).toEqual([
      { text: '{count}', isPlaceholder: true },
      { text: ' accepted', isPlaceholder: false },
    ])
    expect(splitOnPlaceholders('accepted {count}')).toEqual([
      { text: 'accepted ', isPlaceholder: false },
      { text: '{count}', isPlaceholder: true },
    ])
  })

  it('leaves text with no placeholders as one segment', () => {
    expect(splitOnPlaceholders('Sign in')).toEqual([{ text: 'Sign in', isPlaceholder: false }])
  })

  it('reassembles to the original string', () => {
    const text = 'Note to {name}, {count} accepted'
    expect(
      splitOnPlaceholders(text)
        .map((segment) => segment.text)
        .join(''),
    ).toBe(text)
  })
})

describe('flatten / unflatten', () => {
  it('flattens nested keys to dot paths and back', () => {
    const nested = { a: { b: 'c', d: { e: 'f' } } }
    const flat = flatten(nested)
    expect(flat).toEqual({ 'a.b': 'c', 'a.d.e': 'f' })
    expect(unflatten(flat)).toEqual(nested)
  })

  it('handles a top-level string', () => {
    expect(flatten('hello', 'greeting')).toEqual({ greeting: 'hello' })
  })
})

describe('isFrozenKey', () => {
  it('freezes a wordmark, so the translator never renames the project', () => {
    // Every one of these is a name LibreTranslate has actually mangled:
    // Wikidonnées, OuvrirStreetMap, Plejaden, Aracide, iDAI.gazetteter.
    expect(isFrozenKey('siteExternalLinks.schemes.wikidata')).toBe(true)
    expect(isFrozenKey('siteExternalLinks.schemes.osmway')).toBe(true)
    expect(isFrozenKey('enrichment.sources.pleiades')).toBe(true)
    expect(isFrozenKey('columns.marcusAurelius.tafeln-i-lxiv')).toBe(true)
  })

  it('freezes whole vocabulary namespaces', () => {
    // "Settlement" reads as the financial sense to a general model, and
    // "Watchtower" as the magazine.
    expect(isFrozenKey('categories.settlement')).toBe(true)
    expect(isFrozenKey('limesMarks.watchtower')).toBe(true)
    expect(isFrozenKey('enrichment.languages.en')).toBe(true)
  })

  it('leaves a descriptive label in the same namespace translatable', () => {
    // The point of listing wordmarks individually rather than freezing
    // `siteExternalLinks.schemes.*` wholesale: these two are sentences, and a
    // reader is better served by them in their own language.
    expect(isFrozenKey('siteExternalLinks.schemes.dare')).toBe(false)
    expect(isFrozenKey('siteExternalLinks.schemes.edh')).toBe(false)
  })

  it('leaves ordinary interface strings alone', () => {
    expect(isFrozenKey('auth.login.email')).toBe(false)
    expect(isFrozenKey('basemapSwitcher.showPorts')).toBe(false)
  })
})
