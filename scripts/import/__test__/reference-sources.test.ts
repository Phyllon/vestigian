/* eslint-disable sonarjs/no-clear-text-protocols -- fixture identifiers copied from the sources (nomisma.org, wikidata.org, creativecommons.org, geonames.org); nothing here is ever requested */
import { describe, expect, it } from 'vitest'
import { certaintyOf, parseRoadFeature, type ItinereFeature } from '../21-itinere-roads'
import {
  nomismaIdFrom,
  parseMintBindings,
  pleiadesIdFrom,
  type MintBinding,
} from '../22-nomisma-mints'
import {
  isInRomanWorld,
  parseMonumentBindings,
  parsePointWkt,
  wikidataIdFrom,
  type MonumentRow,
} from '../23-wikidata-monuments'
import {
  editionToText,
  licenceFromUrl,
  parseCustomYear,
  parseGeo,
  parseIsicilyXml,
  trailingNumber,
} from '../24-isicily-inscriptions'
import {
  extentOf,
  overlapsRegion,
  parsePolityFeature,
  type PolityFeature,
} from '../25-cliopatria-polities'
import {
  PERIOD_COLUMNS,
  TYPE_COLUMNS,
  numberOrNull,
  parseHillfortRecord,
  reliabilityOf,
  type HillfortRecord,
} from '../26-hillforts-atlas'
import { DOMParser } from '@xmldom/xmldom'

describe('Itiner-e roads', () => {
  const feature = (overrides: Partial<ItinereFeature['properties']> = {}): ItinereFeature => ({
    properties: {
      Name: 'Tingi-Tamuda',
      Route_Type: 2,
      Itinerary: null,
      Segment_s: 'Conjectured',
      Citation: 'Mathias H. Johansen',
      Bibliograp: 'BAtlas 28',
      ...overrides,
    },
    geometry: { type: 'MultiLineString', coordinates: [[[0, 0]]] },
  })

  it('maps the three certainty values the release uses, whatever their case', () => {
    expect(certaintyOf('Certain')).toBe('certain')
    expect(certaintyOf(' conjectured ')).toBe('conjectured')
    expect(certaintyOf('HYPOTHETICAL')).toBe('hypothetical')
  })

  it('refuses an unknown certainty instead of filing it under a default', () => {
    // A changed vocabulary upstream must stop the import, not mislabel 14,000 roads.
    expect(() => certaintyOf('Probable')).toThrow(/Unknown Itiner-e/)
    expect(() => certaintyOf(null)).toThrow()
  })

  it('reads Route_Type 2 as a main road and everything else as secondary', () => {
    expect(parseRoadFeature(feature({ Route_Type: 2 }))?.isMain).toBe(true)
    expect(parseRoadFeature(feature({ Route_Type: 1 }))?.isMain).toBe(false)
  })

  it('drops a feature that is not a line', () => {
    const point: ItinereFeature = { ...feature(), geometry: { type: 'Point', coordinates: [0, 0] } }
    expect(parseRoadFeature(point)).toBeNull()
  })

  it('trims text and turns a blank itinerary into null', () => {
    const row = parseRoadFeature(feature({ Name: '  Via Appia ', Itinerary: '   ' }))
    expect(row?.name).toBe('Via Appia')
    expect(row?.itinerary).toBeNull()
  })
})

describe('Nomisma mints', () => {
  const binding = (overrides: Partial<MintBinding> = {}): MintBinding => ({
    m: { value: 'http://nomisma.org/id/Paktye' },
    label: { value: 'Pactye' },
    lat: { value: '40.485384' },
    long: { value: '26.780688' },
    ...overrides,
  })

  it('takes the identifier from the concept URI', () => {
    expect(nomismaIdFrom('http://nomisma.org/id/Paktye')).toBe('Paktye')
    expect(nomismaIdFrom('http://nomisma.org/id/Ptolemais%20Lebedus')).toBe('Ptolemais Lebedus')
  })

  it('reads a Pleiades place id only from a real Pleiades place URI', () => {
    expect(pleiadesIdFrom('https://pleiades.stoa.org/places/501546')).toBe('501546')
    expect(pleiadesIdFrom('https://pleiades.stoa.org/places/501546/')).toBe('501546')
    expect(pleiadesIdFrom('https://example.org/places/abc')).toBeNull()
    expect(pleiadesIdFrom(undefined)).toBeNull()
  })

  it('keeps one row per mint and prefers the exact Pleiades match to a close one', () => {
    const rows = parseMintBindings([
      binding({ close: { value: 'https://pleiades.stoa.org/places/1' } }),
      binding({ exact: { value: 'https://pleiades.stoa.org/places/2' } }),
    ])
    expect(rows).toHaveLength(1)
    // First binding wins unless it had no link at all; here it already had one.
    expect(rows[0]?.pleiadesId).toBe('1')
  })

  it('fills in a Pleiades link that only a later binding carries', () => {
    const rows = parseMintBindings([
      binding(),
      binding({ exact: { value: 'https://pleiades.stoa.org/places/9' } }),
    ])
    expect(rows[0]?.pleiadesId).toBe('9')
  })

  it('drops a mint with no name or an out-of-range coordinate', () => {
    expect(parseMintBindings([binding({ label: undefined })])).toEqual([])
    expect(parseMintBindings([binding({ lat: { value: '91' } })])).toEqual([])
    expect(parseMintBindings([binding({ long: { value: 'not a number' } })])).toEqual([])
  })
})

describe('Wikidata monuments', () => {
  it('reads longitude first, the opposite of how coordinates are usually written', () => {
    // Cologne: 6.96 E, 50.94 N. Reading it as lat/lon would put it in the Indian Ocean.
    expect(parsePointWkt('Point(6.9603 50.9375)')).toEqual({ lon: 6.9603, lat: 50.9375 })
    expect(parsePointWkt('Point(-0.5 53.2)')).toEqual({ lon: -0.5, lat: 53.2 })
  })

  it('rejects anything that is not a point, including a Wikidata "unknown value" blank node', () => {
    expect(parsePointWkt('http://www.wikidata.org/.well-known/genid/e1e5272b')).toBeNull()
    expect(parsePointWkt('Point(abc def)')).toBeNull()
    expect(parsePointWkt('Point(200 10)')).toBeNull()
    expect(parsePointWkt('LineString(0 0, 1 1)')).toBeNull()
  })

  it('takes the Q id from an entity URI', () => {
    expect(wikidataIdFrom('http://www.wikidata.org/entity/Q19757')).toBe('Q19757')
    expect(wikidataIdFrom('http://www.wikidata.org/prop/direct/P31')).toBeNull()
  })

  it('keeps the Roman world and drops the Brazilian courthouse', () => {
    expect(isInRomanWorld({ lon: 6.96, lat: 50.94 })).toBe(true)
    expect(isInRomanWorld({ lon: -43.19, lat: -19.82 })).toBe(false)
    expect(isInRomanWorld({ lon: 37.46, lat: 12.62 })).toBe(false)
  })

  it('drops an item whose only label is its own id, and keeps the first class an item has', () => {
    const rows = new Map<string, MonumentRow>()
    const item = (id: string, label: string) => ({
      item: { value: `http://www.wikidata.org/entity/${id}` },
      itemLabel: { value: label },
      coord: { value: 'Point(6.9 50.9)' },
    })

    parseMonumentBindings(
      [item('Q1', 'Q1'), item('Q2', 'Amphitheatre of Xanten')],
      'amphitheatre',
      rows,
    )
    parseMonumentBindings([item('Q2', 'Xanten')], 'theatre', rows)

    expect([...rows.keys()]).toEqual(['Q2'])
    expect(rows.get('Q2')).toMatchObject({ kind: 'amphitheatre', name: 'Amphitheatre of Xanten' })
  })
})

describe('I.Sicily', () => {
  const record = (overrides: { licence?: string; idno?: string; geo?: string } = {}): string => `
    <TEI xmlns="http://www.tei-c.org/ns/1.0">
      <teiHeader><fileDesc>
        <titleStmt><title>Funerary inscription of Zethus</title></titleStmt>
        <publicationStmt>
          <idno type="filename">${overrides.idno ?? 'ISic000001'}</idno>
          <idno type="TM">491696</idno>
          <idno type="EDR">071633</idno>
          <availability><licence target="${overrides.licence ?? 'http://creativecommons.org/licenses/by/4.0/'}">x</licence></availability>
        </publicationStmt>
        <sourceDesc><msDesc>
          <msContents><textLang mainLang="la">Latin</textLang></msContents>
          <physDesc><objectDesc><supportDesc><support>
            <material>marble</material><objectType>plaque</objectType>
          </support></supportDesc></objectDesc></physDesc>
          <history><origin>
            <origPlace>
              <placeName type="ancient" ref="http://pleiades.stoa.org/places/462410">Panhormus</placeName>
              <placeName type="modern" ref="http://sws.geonames.org/2523920">Palermo</placeName>
              <geo>${overrides.geo ?? '38.13205, 13.33561'}</geo>
            </origPlace>
            <origDate notBefore-custom="-0300" notAfter-custom="-0101">3rd — 2nd century BCE</origDate>
          </origin></history>
        </msDesc></sourceDesc>
      </fileDesc>
      <profileDesc><textClass><keywords><term ana="#function.funerary">funerary</term></keywords></textClass></profileDesc>
      </teiHeader>
      <text><body>
        <div type="edition" subtype="primary"><ab>
          <lb n="1"/><w>Dis</w> <expan><abbr>man</abbr><ex>ibus</ex></expan>
          <lb n="2"/><supplied>Zethi</supplied> <gap/>
        </ab></div>
        <div type="edition" subtype="simple-lemmatized"><ab><w lemma="x">ignored</w></ab></div>
        <div type="translation" xml:lang="it"><p>Italiano</p></div>
        <div type="translation" xml:lang="en"><p>To the shades.</p></div>
      </body></text>
    </TEI>`

  it('takes the id from the file name, not from a copy-pasted <idno>', () => {
    // Four upstream files name a different record in their own idno; the unique key collided.
    const result = parseIsicilyXml(record({ idno: 'ISic000999' }), 'ISic001733.xml')
    expect('row' in result && result.row.isicilyId).toBe('ISic001733')
  })

  it('refuses a file whose name is not an I.Sicily id', () => {
    expect(parseIsicilyXml(record(), 'notes.xml')).toEqual({ skipped: 'no-id' })
  })

  it('reads a full record: language, function, dating in traditional years, edition, translation', () => {
    const result = parseIsicilyXml(record(), 'ISic000001.xml')
    if (!('row' in result)) throw new Error('expected a row')

    expect(result.row).toMatchObject({
      title: 'Funerary inscription of Zethus',
      language: 'la',
      inscriptionFunction: 'funerary',
      material: 'marble',
      objectType: 'plaque',
      notBefore: -300,
      notAfter: -101,
      placeName: 'Palermo',
      ancientPlaceName: 'Panhormus',
      pleiadesId: '462410',
      trismegistosId: '491696',
      edrId: '071633',
      licence: 'CC-BY-4.0',
      translation: 'To the shades.',
      lon: 13.33561,
      lat: 38.13205,
    })
    // Leiden convention, the primary edition only, never the lemmatised copy.
    expect(result.row.edition).toBe('Dis man(ibus)\n[Zethi] [---]')
  })

  it('keeps a CC BY-NC record under its own licence and refuses an unknown one', () => {
    const nc = parseIsicilyXml(
      record({ licence: 'https://creativecommons.org/licenses/by-nc/4.0/' }),
      'ISic000002.xml',
    )
    expect('row' in nc && nc.row.licence).toBe('CC-BY-NC-4.0')

    expect(
      parseIsicilyXml(record({ licence: 'https://example.org/proprietary' }), 'ISic000003.xml'),
    ).toEqual({ skipped: 'unknown-licence' })
  })

  it('leaves a record unlocated when its <geo> is not a coordinate', () => {
    for (const geo of ['...', '', '36.8,14.5; now in the Museum of Ragusa', '37.3,14.7,534']) {
      const result = parseIsicilyXml(record({ geo }), 'ISic000004.xml')
      expect('row' in result && result.row.lon).toBeNull()
    }
  })

  it('reads geo as latitude first', () => {
    expect(parseGeo('37.49025, 14.06216')).toEqual({ lat: 37.49025, lon: 14.06216 })
    expect(parseGeo('95, 14')).toBeNull()
  })

  it("reads the file's own plain years, negative for BCE", () => {
    expect(parseCustomYear('0051')).toBe(51)
    expect(parseCustomYear('-0300')).toBe(-300)
    expect(parseCustomYear('about 300')).toBeNull()
    expect(parseCustomYear(null)).toBeNull()
  })

  it('accepts the two licences the corpus states, over either scheme, and nothing else', () => {
    expect(licenceFromUrl('http://creativecommons.org/licenses/by/4.0/')).toBe('CC-BY-4.0')
    expect(licenceFromUrl('https://creativecommons.org/licenses/by-nc/4.0')).toBe('CC-BY-NC-4.0')
    expect(licenceFromUrl('https://creativecommons.org/licenses/by-sa/4.0/')).toBeNull()
    expect(licenceFromUrl(null)).toBeNull()
  })

  it('takes the numeric tail of a Pleiades or GeoNames reference', () => {
    expect(trailingNumber('http://pleiades.stoa.org/places/462410')).toBe('462410')
    expect(trailingNumber('http://sws.geonames.org/2523920/')).toBe('2523920')
    expect(trailingNumber('http://example.org/places/none')).toBeNull()
  })

  it('renders an unexpanded abbreviation and ignores apparatus', () => {
    const xml = `<div xmlns="http://www.tei-c.org/ns/1.0"><lb n="1"/>a<expan><abbr>vix</abbr></expan><note>ignored</note></div>`
    const division = new DOMParser().parseFromString(xml, 'text/xml').documentElement
    expect(editionToText(division as unknown as Parameters<typeof editionToText>[0])).toBe('avix')
  })
})

describe('Cliopatria polities', () => {
  const square = (west: number, south: number, east: number, north: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  })

  const feature = (
    overrides: Partial<PolityFeature['properties']> = {},
    geometry: PolityFeature['geometry'] = square(10, 35, 20, 45),
  ): PolityFeature => ({
    properties: {
      Name: 'Carthage',
      FromYear: -264,
      ToYear: -241,
      Area: 227000.4,
      Type: 'POLITY',
      Wikipedia: 'Ancient Carthage',
      Wikidata: 'Q2429397',
      ...overrides,
    },
    geometry,
  })

  it('keeps a neighbouring polity inside the window and the region', () => {
    expect(parsePolityFeature(feature())).toMatchObject({
      name: 'Carthage',
      fromYear: -264,
      toYear: -241,
      wikidataId: 'Q2429397',
      areaSquareKilometres: 227000,
    })
  })

  it('leaves Rome to OpenHistoricalMap', () => {
    for (const name of [
      'Roman Republic',
      'Roman Empire',
      'Western Roman Empire',
      'Roman Kingdom',
    ]) {
      expect(parsePolityFeature(feature({ Name: name }))).toBeNull()
    }
    // A realm that merely contains the word is not excluded.
    expect(parsePolityFeature(feature({ Name: 'Western Satraps' }))).not.toBeNull()
  })

  it('skips Seshat alias entries, which duplicate a realm and its label', () => {
    expect(parsePolityFeature(feature({ Name: '(Macedonian Empire)' }))).toBeNull()
    expect(parsePolityFeature(feature({ Name: 'Macedonian Empire' }))).not.toBeNull()
  })

  it('skips relations, and slices wholly outside 509 BCE to 476 CE', () => {
    expect(parsePolityFeature(feature({ Type: 'RELATION' }))).toBeNull()
    expect(parsePolityFeature(feature({ FromYear: -3400, ToYear: -3201 }))).toBeNull()
    expect(parsePolityFeature(feature({ FromYear: 477, ToYear: 600 }))).toBeNull()
    // A slice that merely overlaps the window is kept.
    expect(parsePolityFeature(feature({ FromYear: -700, ToYear: -509 }))).not.toBeNull()
  })

  it('skips a realm that never touches Europe or the Mediterranean', () => {
    expect(parsePolityFeature(feature({ Name: 'Eastern Wu' }, square(100, 20, 120, 35)))).toBeNull()
  })

  it('finds the extent through a MultiPolygon', () => {
    const multi = {
      type: 'MultiPolygon',
      coordinates: [square(0, 31, 1, 32).coordinates, square(5, 40, 8, 45).coordinates],
    }
    expect(extentOf(multi.coordinates)).toEqual([0, 31, 8, 45])
    expect(overlapsRegion(multi)).toBe(true)
  })

  it('turns a blank or malformed Wikidata id into null', () => {
    expect(parsePolityFeature(feature({ Wikidata: '' }))?.wikidataId).toBeNull()
    expect(parsePolityFeature(feature({ Wikidata: 'not-an-id' }))?.wikidataId).toBeNull()
  })
})

describe('Atlas of Hillforts', () => {
  const record = (overrides: HillfortRecord = {}): HillfortRecord => ({
    'Atlas Number': '31',
    'Display Name': 'Sutton Walls, Herefordshire',
    Country: 'England',
    'Reliability of Data': 'Confirmed',
    Longitude: '-2.6933',
    Latitude: '52.1347',
    'Altitude (m)': '140.0',
    'Total Enclosed Area (ha)': '12.5',
    'Hillfort Type: Promontory Fort': 'Yes',
    'Hillfort Type: Contour Fort': 'No',
    'Dating Evidence: AD50 - AD400': 'Yes',
    'Dating Evidence: Unknown': 'No',
    ...overrides,
  })

  it('reads a full row: coordinates, flags as keys, size and rounded altitude', () => {
    expect(parseHillfortRecord(record())).toEqual({
      atlasNumber: '31',
      name: 'Sutton Walls, Herefordshire',
      country: 'England',
      reliability: 'confirmed',
      types: ['promontory'],
      datedPeriods: ['ad50-400'],
      areaHectares: 12.5,
      altitudeMetres: 140,
      lon: -2.6933,
      lat: 52.1347,
    })
  })

  it('treats a blank size or altitude as not recorded, never as zero', () => {
    const row = parseHillfortRecord(record({ 'Total Enclosed Area (ha)': '', 'Altitude (m)': '' }))
    expect(row?.areaHectares).toBeNull()
    expect(row?.altitudeMetres).toBeNull()
    expect(numberOrNull('  ')).toBeNull()
    expect(numberOrNull('0')).toBe(0)
  })

  it('does not store "Unknown" dating as a period', () => {
    const row = parseHillfortRecord(
      record({ 'Dating Evidence: AD50 - AD400': 'No', 'Dating Evidence: Unknown': 'Yes' }),
    )
    expect(row?.datedPeriods).toEqual([])
    expect(Object.values(PERIOD_COLUMNS)).not.toContain('unknown')
  })

  it("maps the atlas's three reliability words and refuses a fourth", () => {
    expect(reliabilityOf('Confirmed')).toBe('confirmed')
    expect(reliabilityOf('Unconfirmed')).toBe('unconfirmed')
    expect(reliabilityOf('Irreconciled issues')).toBe('irreconciled')
    // A changed vocabulary must stop the import rather than be filed under a default.
    expect(() => reliabilityOf('Probable')).toThrow(/Unknown Atlas of Hillforts/)
  })

  it('drops a row that cannot be named or placed instead of guessing', () => {
    expect(parseHillfortRecord(record({ Longitude: '' }))).toBeNull()
    expect(parseHillfortRecord(record({ Latitude: 'n/a' }))).toBeNull()
    expect(parseHillfortRecord(record({ 'Display Name': ' ' }))).toBeNull()
    expect(parseHillfortRecord(record({ Latitude: '95' }))).toBeNull()
  })

  it('has one key per column, with no duplicates', () => {
    for (const columns of [TYPE_COLUMNS, PERIOD_COLUMNS]) {
      const keys = Object.values(columns)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})
