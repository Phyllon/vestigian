import { describe, expect, it } from 'vitest'
import { buildExternalUrl } from '../site-record'

describe('buildExternalUrl', () => {
  it('builds a straight prefix join for the simple schemes', () => {
    expect(buildExternalUrl('pleiades', '10365480')).toBe(
      'https://pleiades.stoa.org/places/10365480',
    )
    expect(buildExternalUrl('wikidata', 'Q2409236')).toBe('https://www.wikidata.org/wiki/Q2409236')
    expect(buildExternalUrl('vici', '80')).toBe('https://vici.org/vici/80')
    expect(buildExternalUrl('trismegistos', '12345')).toBe(
      'https://www.trismegistos.org/place/12345',
    )
    expect(buildExternalUrl('arachne', '1210192')).toBe('https://arachne.dainst.org/entity/1210192')
    expect(buildExternalUrl('osmway', '104278148')).toBe(
      'https://www.openstreetmap.org/way/104278148',
    )
    expect(buildExternalUrl('osmnode', '1002125366')).toBe(
      'https://www.openstreetmap.org/node/1002125366',
    )
  })

  it('reattaches the TPPlace prefix omnesviae strips on import', () => {
    expect(buildExternalUrl('omnesviae', '1000')).toBe('https://omnesviae.org/#TPPlace1000')
  })

  it('splits a wikipedia value into language and title', () => {
    expect(buildExternalUrl('wikipedia', 'ca:Aeso')).toBe('https://ca.wikipedia.org/wiki/Aeso')
    // A title may itself contain a colon — only the first split matters.
    expect(buildExternalUrl('wikipedia', 'en:Battle:of:Somewhere')).toBe(
      'https://en.wikipedia.org/wiki/Battle%3Aof%3ASomewhere',
    )
  })

  it('rejects a wikipedia value with no language or no title', () => {
    expect(buildExternalUrl('wikipedia', 'notitle:')).toBeNull()
    expect(buildExternalUrl('wikipedia', 'notaproperformat')).toBeNull()
  })

  it('lowercases the value for a PECS lookup', () => {
    expect(buildExternalUrl('pecs', 'Urso')).toBe(
      'http://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.04.0006:id=urso',
    )
  })

  it('appends .html for a DARE id', () => {
    expect(buildExternalUrl('dare', '11067')).toBe('https://imperium.ahlfeldt.se/places/11067.html')
  })

  it('builds URLs for the three schemes verify-concordances.ts writes', () => {
    expect(buildExternalUrl('edh', '33678')).toBe(
      'https://edh-www.adw.uni-heidelberg.de/edh/geographie/33678',
    )
    expect(buildExternalUrl('idai-gazetteer', '2085996')).toBe(
      'https://gazetteer.dainst.org/place/2085996',
    )
    expect(buildExternalUrl('historic-england', '1010966')).toBe(
      'https://historicengland.org.uk/listing/the-list/list-entry/1010966',
    )
  })

  it('leaves schemes with no confirmed URL pattern unlinked', () => {
    expect(buildExternalUrl('livius', 'troy')).toBeNull()
    expect(buildExternalUrl('livius', 'place=augusta-treverorum-trier/trier-photos')).toBeNull()
    expect(buildExternalUrl('mithraeum', '100')).toBeNull()
    expect(buildExternalUrl('romaq', '146')).toBeNull()
    expect(buildExternalUrl('archis', '1477')).toBeNull()
  })

  it('returns null for a scheme it has never heard of', () => {
    expect(buildExternalUrl('made-up-scheme', 'anything')).toBeNull()
  })
})
