import { describe, expect, it } from 'vitest'
import { LICENCE_BY_ID } from '../../../scripts/import/vici-licences'
import { licenceLabel, licenceUri } from '../licence-uris'
import {
  LIMES_SOURCE_LICENCE,
  ODBL_FEED_LAYERS,
  ODBL_FEED_META,
  odblFeedPath,
  parseOdblFeedName,
} from '../odbl-feeds'

describe('parseOdblFeedName', () => {
  it('reads a layer and a format from the path segment', () => {
    expect(parseOdblFeedName('awmc-lines.geojson')).toEqual({
      layer: 'awmc-lines',
      format: 'geojson',
    })
    expect(parseOdblFeedName('limes.ttl')).toEqual({ layer: 'limes', format: 'ttl' })
  })

  it('refuses a layer or format that is not offered', () => {
    expect(parseOdblFeedName('awmc-lines')).toBeNull()
    expect(parseOdblFeedName('awmc-lines.json')).toBeNull()
    expect(parseOdblFeedName('antiquity_places.geojson')).toBeNull()
    expect(parseOdblFeedName('.geojson')).toBeNull()
  })

  it('round-trips with odblFeedPath', () => {
    for (const layer of ODBL_FEED_LAYERS) {
      const name = odblFeedPath(layer, 'ttl').replace('/api/odbl/', '')
      expect(parseOdblFeedName(name)).toEqual({ layer, format: 'ttl' })
    }
  })
})

describe('ODBL_FEED_META', () => {
  it('describes every layer, and names ODbL for all of them', () => {
    for (const layer of ODBL_FEED_LAYERS) {
      expect(ODBL_FEED_META[layer].licences).toContain('ODbL-1.0')
    }
  })

  it('offers a default page the layer is allowed to return', () => {
    for (const layer of ODBL_FEED_LAYERS) {
      const { defaultLimit, maxLimit } = ODBL_FEED_META[layer]
      expect(defaultLimit).toBeGreaterThan(0)
      expect(defaultLimit).toBeLessThanOrEqual(maxLimit)
      expect(maxLimit).toBeLessThanOrEqual(1000)
    }
  })

  it('records what was altered, as ODbL §4.6(b) asks, for every layer', () => {
    for (const layer of ODBL_FEED_LAYERS) {
      expect(ODBL_FEED_META[layer].alterations.length).toBeGreaterThan(20)
    }
  })

  it('states both terms CHRR is published under, because its sources disagree', () => {
    expect(ODBL_FEED_META['coin-hoards'].licences).toEqual(['ODbL-1.0', 'CC-BY-NC-3.0'])
    expect(ODBL_FEED_META['coin-hoards'].credit).toContain('non-commercial')
  })

  it('resolves every licence it names to a URL', () => {
    for (const layer of ODBL_FEED_LAYERS) {
      for (const code of ODBL_FEED_META[layer].licences) {
        expect(licenceUri(code), code).toMatch(/^https:\/\//)
      }
    }
  })
})

describe('LIMES_SOURCE_LICENCE', () => {
  it('keeps the CC0 sources apart from the ODbL ones', () => {
    expect(LIMES_SOURCE_LICENCE.osm).toBe('ODbL 1.0')
    expect(LIMES_SOURCE_LICENCE.ohm).toBe('CC0 1.0')
    expect(LIMES_SOURCE_LICENCE.extent).toBe('ODbL 1.0')
  })
})

describe('licenceUri / licenceLabel', () => {
  it('accepts database codes and importer labels alike', () => {
    expect(licenceUri('CC-BY-SA-3.0')).toBe('https://creativecommons.org/licenses/by-sa/3.0/')
    expect(licenceUri('CC BY 4.0')).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(licenceUri('OGL v3')).toBe(licenceUri('OGL-3.0'))
  })

  it('links every licence an image can be credited under, except all-rights-reserved', () => {
    // An image credit has to link its licence's text; a code added to the vici table
    // without an entry here would silently render as an unlinked string.
    for (const code of new Set(Object.values(LICENCE_BY_ID))) {
      if (code === 'ARR') continue
      expect(licenceUri(code), code).toMatch(/^https:\/\//)
    }
  })

  it('keeps a ported licence’s jurisdiction in its link', () => {
    expect(licenceUri('CC-BY-SA-3.0-ES')).toBe('https://creativecommons.org/licenses/by-sa/3.0/es/')
    expect(licenceLabel('CC-BY-SA-3.0-ES')).toBe('CC BY-SA 3.0 ES')
  })

  it('does not guess at a licence it cannot place', () => {
    expect(licenceUri('OGL')).toBeNull()
    expect(licenceUri('CC0 1.0 or CC BY-SA 3.0 (per tracing)')).toBeNull()
    expect(licenceLabel('OGL')).toBe('OGL')
  })
})
