import { describe, expect, it } from 'vitest'
import { stripHtml } from '../sanitize'

describe('stripHtml', () => {
  it('leaves ordinary free text untouched, angle brackets included', () => {
    expect(stripHtml('the wall is <2m tall')).toBe('the wall is <2m tall')
  })

  it('removes a script tag and its content', () => {
    expect(stripHtml('<script>alert(1)</script>plain text')).toBe('plain text')
  })

  it('removes an attribute-borne payload along with its tag', () => {
    expect(stripHtml('a description <img src=x onerror=alert(1)> continues')).toBe(
      'a description  continues',
    )
  })

  it('unwraps formatting tags without dropping their text', () => {
    expect(stripHtml('<b>bold</b> and <i>italic</i>')).toBe('bold and italic')
  })

  it('does not double-encode entities in the stored plain text', () => {
    expect(stripHtml('Tom & Jerry <3')).toBe('Tom & Jerry <3')
  })

  it('turns block boundaries and <br> into newlines instead of joining text', () => {
    expect(stripHtml('<p>paragraph one</p><p>paragraph two</p>')).toBe(
      'paragraph one\nparagraph two',
    )
    expect(stripHtml('line one<br>line two<br/>line three')).toBe('line one\nline two\nline three')
  })

  it('trims surrounding whitespace', () => {
    expect(stripHtml('  spaced out  ')).toBe('spaced out')
  })

  it('is idempotent, so re-running it on already-clean text changes nothing', () => {
    const clean = stripHtml('the aqueduct runs <5km through the valley')
    expect(stripHtml(clean)).toBe(clean)
  })
})
