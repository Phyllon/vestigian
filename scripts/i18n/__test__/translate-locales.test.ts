import { describe, expect, it } from 'vitest'
import { flatten, splitOnPlaceholders, unflatten } from '../translate-locales'

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
