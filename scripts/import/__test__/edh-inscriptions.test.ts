import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import {
  countryCodeFromGeonamesUri,
  diplomaticText,
  normaliseVocabTerm,
  parseEditionAb,
  parseYear,
  trailingId,
} from '../12-edh-inscriptions'

describe('trailingId', () => {
  it('strips the leading zeros a real inscription record carries', () => {
    // The exact mismatch that made the Trismegistos join silently match
    // nothing on the first live run: this corpus's own `ref` URLs are
    // zero-padded, `edh_findspots` is not.
    expect(trailingId('https://www.trismegistos.org/place/014437')).toBe('14437')
  })

  it('leaves an already-unpadded id alone', () => {
    expect(trailingId('https://www.trismegistos.org/place/172')).toBe('172')
  })

  it('returns null for a URI with no trailing number', () => {
    expect(trailingId('https://www.trismegistos.org/')).toBeNull()
    expect(trailingId(null)).toBeNull()
  })
})

describe('countryCodeFromGeonamesUri', () => {
  it('reads the two-letter code and upper-cases it', () => {
    expect(countryCodeFromGeonamesUri('https://www.geonames.org/countries/it/')).toBe('IT')
  })

  it('returns null when there is no country segment', () => {
    expect(countryCodeFromGeonamesUri('https://www.geonames.org/')).toBeNull()
    expect(countryCodeFromGeonamesUri(null)).toBeNull()
  })
})

describe('parseYear', () => {
  it('reads a zero-padded four-digit year as a plain integer', () => {
    expect(parseYear('0071')).toBe(71)
    expect(parseYear('0130')).toBe(130)
  })

  it('returns null for anything unparseable', () => {
    expect(parseYear(null)).toBeNull()
    expect(parseYear('unknown')).toBeNull()
  })
})

describe('normaliseVocabTerm', () => {
  const table = { grabinschrift: 'funerary' }

  it('maps a known German term to its English slug', () => {
    expect(normaliseVocabTerm('Grabinschrift', table)).toBe('funerary')
  })

  it("strips EDH's own uncertainty marker before matching", () => {
    // A real, frequently-observed shape: EDH appends '?' to a term when its
    // own classification is uncertain ('Grabinschrift?') — missed entirely
    // by the first version of this lookup.
    expect(normaliseVocabTerm('Grabinschrift?', table)).toBe('funerary')
  })

  it('keeps an unrecognised term verbatim rather than guessing', () => {
    expect(normaliseVocabTerm('Verzeichnis', {})).toBe('Verzeichnis')
  })

  it('returns null for no term at all', () => {
    expect(normaliseVocabTerm(null, table)).toBeNull()
  })
})

/** Parses a minimal EpiDoc `<div type="edition">` fragment down to its `<ab>`. */
const parseAb = (editionXml: string) => {
  const doc = new DOMParser().parseFromString(
    `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>${editionXml}</body></text></TEI>`,
    'text/xml',
  )
  const ab = doc.getElementsByTagName('ab').item(0)
  if (!ab) throw new Error('test fixture carries no <ab>')
  return ab
}

describe('parseEditionAb', () => {
  it('numbers the first line 1, not 2 — the real off-by-one this project shipped once', () => {
    // The exact shape HD000001.xml carries: a bare `<lb n="1"/>` before any
    // content at all. The first version of this parser flushed (nothing to
    // flush) and then unconditionally incremented, landing this content on
    // "line 2".
    const ab = parseAb('<div type="edition"><ab><lb n="1"/>D M <lb n="2"/>Noniae</ab></div>')
    const lines = parseEditionAb(ab)
    expect(lines[0]?.line).toBe(1)
    expect(lines[0]?.tokens.map((t) => t.text)).toEqual(['D M'])
    expect(lines[1]?.line).toBe(2)
    expect(lines[1]?.tokens.map((t) => t.text)).toEqual(['Noniae'])
  })

  it('reads an abbreviation and its expansion as one token', () => {
    const ab = parseAb(
      '<div type="edition"><ab><lb n="1"/><expan><abbr>D</abbr><ex>is</ex></expan></ab></div>',
    )
    const lines = parseEditionAb(ab)
    expect(lines[0]?.tokens[0]).toEqual({ text: 'D', abbr: 'D', expansion: 'is' })
  })

  it('assigns line 1 to content with no <lb> at all, rather than dropping it', () => {
    const ab = parseAb('<div type="edition"><ab>Optatus filius</ab></div>')
    const lines = parseEditionAb(ab)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.line).toBe(1)
  })

  it('falls back to incrementing when a <lb> carries no usable n attribute', () => {
    const ab = parseAb('<div type="edition"><ab><lb/>one<lb/>two</ab></div>')
    const lines = parseEditionAb(ab)
    expect(lines.map((line) => line.line)).toEqual([1, 2])
  })
})

describe('diplomaticText', () => {
  it('joins tokens within a line and lines with newlines', () => {
    const text = diplomaticText([
      { line: 1, tokens: [{ text: 'D' }, { text: 'M' }] },
      { line: 2, tokens: [{ text: 'Noniae' }] },
    ])
    expect(text).toBe('D M\nNoniae')
  })

  it('returns null for no lines at all', () => {
    expect(diplomaticText([])).toBeNull()
  })
})
