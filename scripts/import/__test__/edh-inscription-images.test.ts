import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { directText, isOpenRightsStatement, parseImageXml } from '../13-edh-inscription-images'

describe('isOpenRightsStatement', () => {
  it('rejects the real rights statement every EDH photograph carries', () => {
    // Checked exhaustively against the full corpus before writing this
    // import: all 43,199 real records name this exact Europeana code.
    expect(
      isOpenRightsStatement(
        'https://www.europeana.eu/rights/rr-f/',
        'Rights Reserved - Free Access on Epigraphischen Fotothek Heidelberg',
      ),
    ).toBe(false)
  })

  it('recognises a genuine Creative Commons target', () => {
    expect(isOpenRightsStatement('https://creativecommons.org/licenses/by-sa/4.0/', null)).toBe(
      true,
    )
  })

  it('recognises CC0 and public domain stated in the text alone', () => {
    expect(isOpenRightsStatement(null, 'Released under CC0')).toBe(true)
    expect(isOpenRightsStatement(null, 'Public domain')).toBe(true)
  })

  it('defaults to closed for an unrecognised statement', () => {
    expect(isOpenRightsStatement(null, 'All rights reserved')).toBe(false)
    expect(isOpenRightsStatement(null, null)).toBe(false)
  })
})

describe('directText', () => {
  it("reads an element's own text without a nested element's text mixed in", () => {
    // The exact shape `<E30.Right>` carries: a rights sentence with the
    // photographer's name nested inside it as a child element. A plain
    // `textContent` read would run both together with no separator.
    const doc = new DOMParser().parseFromString(
      '<root><right>Rights Reserved<actor>Géza Alföldy</actor></right></root>',
      'text/xml',
    )
    const rightEl = doc.getElementsByTagName('right').item(0)
    expect(directText(rightEl)).toBe('Rights Reserved')
  })

  it('returns null for an element with no direct text', () => {
    const doc = new DOMParser().parseFromString(
      '<root><right><actor>Géza Alföldy</actor></right></root>',
      'text/xml',
    )
    const rightEl = doc.getElementsByTagName('right').item(0)
    expect(directText(rightEl)).toBeNull()
  })
})

describe('parseImageXml', () => {
  const buildXml = ({
    withRights = true,
    inscriptionId = '',
  }: {
    withRights?: boolean
    inscriptionId?: string
  } = {}): string => `<?xml version="1.0" encoding="UTF-8"?><rdf:RDF
    xmlns:crm="http://cidoc.ics.forth.gr/rdfs/cidoc_v4.2.rdfs#"
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <crm:E84.Information_Carrier>
      <crm:P1.is_identified_by>
        <crm:E42.Identifier>F000001</crm:E42.Identifier>
        <crm:E42.Identifier type="URI">https://edh-www.adw.uni-heidelberg.de/edh/foto/F000001</crm:E42.Identifier>
      </crm:P1.is_identified_by>
      ${
        withRights
          ? `<crm:P104.is_subject_to>
        <crm:E30.Right target="https://www.europeana.eu/rights/rr-f/">Rights Reserved - Free Access
          <crm:P75B.is_possesed_by>
            <crm:E39.Actor date="1988">Géza Alföldy DF</crm:E39.Actor>
          </crm:P75B.is_possesed_by>
        </crm:E30.Right>
      </crm:P104.is_subject_to>`
          : ''
      }
      <crm:P128.carries>
        <crm:E34.Inscription>
          <crm:P1.is_identified_by>
            <crm:E42.Identifier>${inscriptionId}</crm:E42.Identifier>
          </crm:P1.is_identified_by>
        </crm:E34.Inscription>
      </crm:P128.carries>
    </crm:E84.Information_Carrier>
  </rdf:RDF>`

  it('reads the photo id, source URL, rights statement, holder and linked inscription', () => {
    const record = parseImageXml(buildXml({ inscriptionId: 'HD000001' }), 'F000001')
    expect(record).toEqual({
      edhPhotoId: 'F000001',
      sourceUrl: 'https://edh-www.adw.uni-heidelberg.de/edh/foto/F000001',
      rightsStatement: 'Rights Reserved - Free Access',
      rightsHolder: 'Géza Alföldy DF',
      mirrored: false,
      inscriptionEdhId: 'HD000001',
    })
  })

  it('returns null rather than a row with no rights statement — this is the real gate that stops a byte ever being mirrored without one', () => {
    expect(parseImageXml(buildXml({ withRights: false }), 'F000001')).toBeNull()
  })

  it('reads a missing inscription link as null, not an empty string', () => {
    const record = parseImageXml(buildXml({ inscriptionId: '' }), 'F000001')
    expect(record?.inscriptionEdhId).toBeNull()
  })
})
