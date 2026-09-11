import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import {
  parseAtticDate,
  parseAtticHtml,
  pleiadesIdFromUri,
  stripUncertainty,
} from '../20-attic-inscriptions'

describe('pleiadesIdFromUri', () => {
  it('reads the trailing numeric id from a Pleiades URI', () => {
    expect(pleiadesIdFromUri('https://pleiades.stoa.org/places/579920')).toBe('579920')
  })

  it('reads a newer long-form id the same way', () => {
    expect(pleiadesIdFromUri('https://pleiades.stoa.org/places/807514119')).toBe('807514119')
  })

  it('returns null for a non-numeric or missing href', () => {
    expect(pleiadesIdFromUri('https://pleiades.stoa.org/places/')).toBeNull()
    expect(pleiadesIdFromUri(null)).toBeNull()
    expect(pleiadesIdFromUri(undefined)).toBeNull()
  })
})

describe('parseAtticDate', () => {
  it('orders an archon-year BC range with notBefore chronologically earliest', () => {
    // The real bug this guards: a first version negated the wrong half of
    // the pair and stored notBefore > notAfter for every BC record.
    expect(parseAtticDate('352/1 BC')).toEqual({ notBefore: -352, notAfter: -351 })
  })

  it('expands a truncated second figure against the first year, not literally', () => {
    // '39/8 BC' means 39/38 BC, not 39/8 BC — the second figure only carries
    // the archon year's final digit(s).
    expect(parseAtticDate('39/8 BC')).toEqual({ notBefore: -39, notAfter: -38 })
  })

  it('reads a single CE year with no BC marker as positive', () => {
    expect(parseAtticDate('229 AD')).toEqual({ notBefore: 229, notAfter: 229 })
  })

  it('takes the first candidate from a disjunctive date, rather than nothing', () => {
    expect(parseAtticDate('351/0 BC or 348/7 BC')).toEqual({ notBefore: -351, notAfter: -350 })
  })

  it('returns nulls for missing or unparseable text', () => {
    expect(parseAtticDate(null)).toEqual({ notBefore: null, notAfter: null })
    expect(parseAtticDate('uncertain')).toEqual({ notBefore: null, notAfter: null })
  })
})

describe('stripUncertainty', () => {
  it('strips a trailing "?" so it does not fragment a facet value', () => {
    // Checked live: 'Stele?' and 'Stele' were two separate `monumentType`
    // facet values for the same underlying classification.
    expect(stripUncertainty('Stele?')).toBe('Stele')
  })

  it('leaves a value with no uncertainty marker untouched', () => {
    expect(stripUncertainty('Stele')).toBe('Stele')
  })

  it('passes null through', () => {
    expect(stripUncertainty(null)).toBeNull()
  })
})

describe('parseAtticHtml', () => {
  // A trimmed-down but structurally real fixture — the same element ids and
  // classes AIO's own page actually renders (verified live against
  // atticinscriptions.com before writing the import), not an invented shape.
  const FIXTURE_HTML = `
    <div id="ins_title_area">
      <h3 id="ins_title">On the boundaries of the sacred tract (352/1 BC)</h3>
      <span id="ins_source"><i>IG</i> II<sup>3</sup> 1 292</span>
      <span id="ins_date"> Date: 352/1 BC </span>
    </div>
    <div id="inscription">
      <span class="insline"> <span class="inslineno">(5)</span> the People shall elect
      </span><span class="insline"> straightaway ten men from all the <a class="aio_place" href="http://pleiades.stoa.org/places/579885"><span class="aio_place_icon"></span>Athenians</a> and five from the Council;
      </span><span class="insline"> of the sacred tract<span class="translit"> (hieras orgados)</span><sup><a href="#note-1" id="ref-1">[1]</a></sup>
      </span>
    </div>
    <div class="ins_alt_sources_set">
      <div class="ins_alt_source"><b><a href="/browse/bysource/IGII31/"><i>IG</i> II3 1 292</a> (<a class="highlight" href="https://pom.bbaw.de/ig/1">IG Online</a>)</b></div>
      <div class="ins_alt_source"><a href="/browse/bysource/IGII2/"><i>IG</i> II2 204</a> (<a class="highlight" href="http://epigraphy.packhum.org/text/2422">PHI</a>)</div>
    </div>
    <div class="ins_translators">Translation by: Stephen Lambert</div>
    <div class="ins_type_info_set">
      <div class="ins_type_info">Images: Krateros - (<a href="https://hdl.handle.net/20.500.12111/990">1</a>)</div>
      <div class="ins_type_info">Monument type: Stele?</div>
      <div class="ins_type_info">Inscription type: Decree (People?) and Correction</div>
      <div class="ins_type_info">Original location: Eleusis (By [gateway of the sanctuary]) <a href="http://pleiades.stoa.org/places/579920"><span class="aio_place_icon_sidebar"></span></a></div>
      <div class="ins_type_info">
        Fragment a - Findspot: Eleusis <a href="http://pleiades.stoa.org/places/579920"><span class="aio_place_icon_sidebar"></span></a> (EM 10052)
        <br/>
        Fragment b - Findspot: Eleusis <a href="http://pleiades.stoa.org/places/579920"><span class="aio_place_icon_sidebar"></span></a> (EM 5136)
      </div>
    </div>
    <div class="ins_notes">
      <span class="note" id="note-1"><a href="#ref-1">[1]</a> A tract of land sacred to Demeter and Kore.</span>
    </div>
  `

  const parsed = () => {
    const $ = cheerio.load(FIXTURE_HTML)
    return parseAtticHtml($, 'IGII31/292')
  }

  it('reads the title, source citation and date', () => {
    const result = parsed()
    expect(result.title).toBe('On the boundaries of the sacred tract (352/1 BC)')
    expect(result.primarySource).toContain('292')
    expect(result.dateText).toBe('352/1 BC')
    expect(result.notBefore).toBe(-352)
    expect(result.notAfter).toBe(-351)
  })

  it('strips the uncertainty marker from monument type but not inscription type', () => {
    const result = parsed()
    expect(result.monumentType).toBe('Stele')
    expect(result.inscriptionType).toBe('Decree (People?) and Correction')
  })

  it('reads the original location as a place reference with its Pleiades id', () => {
    const result = parsed()
    expect(result.originalLocation).toEqual({
      text: 'Eleusis (By [gateway of the sanctuary])',
      pleiadesId: '579920',
    })
  })

  it('reads each fragment as its own findspot, not one block of repeated text', () => {
    // The real bug this guards: falling back to the whole block's text
    // produced the same full "Fragment a - Findspot: … Fragment b - …"
    // string for every fragment entry.
    const result = parsed()
    expect(result.findspots).toEqual([
      { text: 'Eleusis', pleiadesId: '579920', label: 'Fragment a' },
      { text: 'Eleusis', pleiadesId: '579920', label: 'Fragment b' },
    ])
  })

  it('reads the image credit', () => {
    const result = parsed()
    expect(result.imageCredits).toEqual([
      { collection: 'Krateros', url: 'https://hdl.handle.net/20.500.12111/990' },
    ])
  })

  it('reads the translators and references', () => {
    const result = parsed()
    expect(result.translators).toEqual(['Stephen Lambert'])
    expect(result.references).toHaveLength(2)
    expect(result.references?.[0]?.externalLinks).toEqual(['https://pom.bbaw.de/ig/1'])
  })

  it('parses the translation into a typed segment list with place, gloss and note segments', () => {
    const result = parsed()
    const segments = result.translationEdition ?? []
    expect(segments).toContainEqual({ type: 'lineNumber', text: '(5)' })
    expect(segments).toContainEqual({
      type: 'place',
      text: 'Athenians',
      pleiadesId: '579885',
    })
    expect(segments).toContainEqual({ type: 'gloss', text: '(hieras orgados)' })
    expect(segments).toContainEqual({ type: 'note', number: 1 })
    // Line boundaries become explicit breaks, not lost whitespace.
    expect(segments.filter((segment) => segment.type === 'break')).toHaveLength(2)
  })

  it('reads the footnote text without its own leading reference marker', () => {
    const result = parsed()
    expect(result.footnotes).toEqual([
      { number: 1, text: 'A tract of land sacred to Demeter and Kore.' },
    ])
  })
})
