import { describe, expect, it } from 'vitest'
import type { LineLayerSpecification } from 'maplibre-gl'
import { MONUMENT_KINDS, REFERENCE_OVERLAY_IDS } from '#shared/utils/reference-overlays'
import { MONUMENT_ICON_GLYPHS, MONUMENT_ICON_ID, monumentIconId } from '../useSiteIcons'
import {
  REFERENCE_OVERLAY_DEFINITIONS,
  ROMAN_ROAD_LAYER_IDS,
  HILLFORT_PERIOD_SPANS,
  HILLFORT_TYPES,
  buildHillfortPopupHtml,
  buildIsicilyPopupHtml,
  buildMintPopupHtml,
  buildMonumentIconExpression,
  buildMonumentPopupHtml,
  buildRomanRoadLayers,
  buildRomanRoadPopupHtml,
  isicilyPath,
} from '../useReferenceOverlays'

const t = (key: string, named?: Record<string, unknown>): string => {
  if (key === 'referencePopup.hillfort.dated') return String(named?.periods)
  if (key === 'periodFormat.undated') return 'Undated'
  if (key === 'periodFormat.bc') return `${named?.year} BC`
  if (key === 'periodFormat.ad') return `AD ${named?.year}`
  if (key === 'periodFormat.yearRange') return `${named?.from} – ${named?.to}`
  return key
}

describe('the overlay definitions', () => {
  it('describe every id the server serves, each with its own source and credit', () => {
    expect(Object.keys(REFERENCE_OVERLAY_DEFINITIONS).sort()).toEqual(
      [...REFERENCE_OVERLAY_IDS].sort(),
    )

    const sources = Object.values(REFERENCE_OVERLAY_DEFINITIONS).map(
      (definition) => definition.sourceId,
    )
    expect(new Set(sources).size).toBe(sources.length)

    // A layer without a credit is an unpaid licence obligation, not a styling gap.
    for (const definition of Object.values(REFERENCE_OVERLAY_DEFINITIONS)) {
      expect(definition.attribution.length).toBeGreaterThan(10)
    }
  })

  it('read the source layer the tile SQL writes, and only layers of their own source', () => {
    const expected = {
      'roman-roads': 'roman_roads',
      mints: 'mints',
      monuments: 'monuments',
      isicily: 'isicily',
      hillforts: 'hillforts',
    }
    for (const id of REFERENCE_OVERLAY_IDS) {
      const definition = REFERENCE_OVERLAY_DEFINITIONS[id]
      for (const layer of definition.buildLayers()) {
        expect('source' in layer && layer.source).toBe(definition.sourceId)
        expect('source-layer' in layer && layer['source-layer']).toBe(expected[id])
      }
    }
  })

  it('only list clickable layers that exist', () => {
    for (const definition of Object.values(REFERENCE_OVERLAY_DEFINITIONS)) {
      const ids = definition.buildLayers().map((layer) => layer.id)
      for (const clickable of definition.clickableLayerIds) expect(ids).toContain(clickable)
    }
  })
})

describe('buildRomanRoadLayers', () => {
  const layers = buildRomanRoadLayers()
  const byId = (id: string) => layers.find((layer) => layer.id === id)

  it('draws one layer per certainty, because dash arrays are not data-driven', () => {
    const paintOf = (id: string) => (byId(id) as LineLayerSpecification).paint

    expect(paintOf(ROMAN_ROAD_LAYER_IDS.certain)).not.toHaveProperty('line-dasharray')
    expect(paintOf(ROMAN_ROAD_LAYER_IDS.conjectured)?.['line-dasharray']).toEqual([4, 2])
    expect(paintOf(ROMAN_ROAD_LAYER_IDS.hypothetical)?.['line-dasharray']).toEqual([1, 2])
  })

  it('filters each by its own certainty and puts the casing underneath', () => {
    expect(layers[0]?.id).toBe(ROMAN_ROAD_LAYER_IDS.casing)
    expect(JSON.stringify(byId(ROMAN_ROAD_LAYER_IDS.certain))).toContain('"certain"')
    expect(JSON.stringify(byId(ROMAN_ROAD_LAYER_IDS.conjectured))).toContain('"conjectured"')
  })

  it('draws the evidence over the model, so a surveyed road is never hidden by a guess', () => {
    const order = layers.map((layer) => layer.id)
    expect(order.indexOf(ROMAN_ROAD_LAYER_IDS.certain)).toBeGreaterThan(
      order.indexOf(ROMAN_ROAD_LAYER_IDS.conjectured),
    )
  })
})

describe('popups', () => {
  it('escape a name before it reaches markup', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    for (const html of [
      buildRomanRoadPopupHtml({ name: hostile, certainty: 'certain', is_main: true }, t),
      buildMintPopupHtml({ name: hostile, nomisma_id: 'Rome' }, t),
      buildMonumentPopupHtml({ name: hostile, kind: 'theatre', wikidata_id: 'Q1' }, t),
      buildIsicilyPopupHtml({ title: hostile, isicily_id: 'ISic000001' }, t),
    ]) {
      expect(html).not.toContain('<img')
      expect(html).toContain('&#60;img')
    }
  })

  it('link a mint only to a well-formed Nomisma and Pleiades id', () => {
    const good = buildMintPopupHtml({ name: 'Rome', nomisma_id: 'rome', pleiades_id: '423025' }, t)
    expect(good).toContain('https://nomisma.org/id/rome')
    expect(good).toContain('https://pleiades.stoa.org/places/423025')

    const bad = buildMintPopupHtml(
      { name: 'Rome', nomisma_id: 'x" onclick="alert(1)', pleiades_id: '1/../../x' },
      t,
    )
    expect(bad).not.toContain('href')
  })

  it('link a monument to Wikidata only for a real Q id, and name its kind', () => {
    const html = buildMonumentPopupHtml(
      { name: 'Theatre', kind: 'theatre', wikidata_id: 'Q19757' },
      t,
    )
    expect(html).toContain('https://www.wikidata.org/wiki/Q19757')
    expect(html).toContain('referencePopup.monument.kind.theatre')

    const bad = buildMonumentPopupHtml(
      { name: 'X', kind: 'spaceport', wikidata_id: 'javascript:1' },
      t,
    )
    expect(bad).not.toContain('href')
    expect(bad).not.toContain('kind.spaceport')
  })

  it('say how sure a road is and who attests it', () => {
    const html = buildRomanRoadPopupHtml(
      {
        name: 'Ad Mercuri-Zilil',
        certainty: 'conjectured',
        is_main: false,
        itinerary: 'Itinerarium Antonini',
      },
      t,
    )
    expect(html).toContain('referencePopup.road.secondary')
    expect(html).toContain('referencePopup.road.certainty.conjectured')
    expect(html).toContain('Itinerarium Antonini')
  })

  it('give an unnamed road segment a label rather than a blank heading', () => {
    expect(buildRomanRoadPopupHtml({ certainty: 'certain', is_main: true }, t)).toContain(
      'referencePopup.road.unnamed',
    )
  })

  it('open an I.Sicily record through the app, and only for a well-formed id', () => {
    expect(isicilyPath({ isicily_id: 'ISic000123' })).toBe('/inscriptions/sicily/ISic000123')
    expect(isicilyPath({ isicily_id: '../admin' })).toBeNull()
    expect(isicilyPath({})).toBeNull()

    expect(buildIsicilyPopupHtml({ title: 'A', isicily_id: '../admin' }, t)).not.toContain('href')
  })

  it('show the period of an I.Sicily record, and nothing for an undated one', () => {
    const dated = buildIsicilyPopupHtml(
      { title: 'A', isicily_id: 'ISic000001', not_before: -300, not_after: -101 },
      t,
    )
    expect(dated).toContain('300 BC – 101 BC')
    expect(buildIsicilyPopupHtml({ title: 'A', isicily_id: 'ISic000001' }, t)).not.toContain(
      'Undated',
    )
  })

  it('name a language only when the catalogue has a word for it', () => {
    expect(buildIsicilyPopupHtml({ title: 'A', language: 'xpu' }, t)).toContain(
      'isicilyInscriptions.languages.xpu',
    )
    expect(buildIsicilyPopupHtml({ title: 'A', language: 'xx' }, t)).not.toContain('languages.xx')
  })
})

describe('the hillfort popup', () => {
  const properties = {
    name: 'Broad Oak, Garway, Herefordshire',
    country: 'England',
    reliability: 'unconfirmed',
    types: 'promontory,multiple-enclosure',
    dated_periods: 'ad50-400,800-400bc',
    area_hectares: 1.25,
    altitude_metres: 140,
  }

  it('names its types, country, size and altitude, and flags a doubtful site', () => {
    const html = buildHillfortPopupHtml(properties, t)
    expect(html).toContain('referencePopup.hillfort.type.promontory')
    expect(html).toContain('referencePopup.hillfort.type.multiple-enclosure')
    expect(html).toContain('referencePopup.hillfort.country.england')
    expect(html).toContain('referencePopup.hillfort.reliability.unconfirmed')
    expect(html).toContain('referencePopup.hillfort.area')
    expect(html).toContain('referencePopup.hillfort.altitude')
  })

  it('says nothing about reliability when the atlas confirmed the site', () => {
    expect(buildHillfortPopupHtml({ ...properties, reliability: 'confirmed' }, t)).not.toContain(
      'reliability',
    )
  })

  it('formats dating evidence with the shared BC/AD helper, so the Roman span reads as one', () => {
    const html = buildHillfortPopupHtml(properties, t)
    expect(html).toContain('AD 50 – AD 400')
    expect(html).toContain('800 BC – 400 BC')
  })

  it('leaves out a size or altitude the atlas did not record, rather than showing zero', () => {
    const html = buildHillfortPopupHtml(
      { name: 'X', country: 'Wales', reliability: 'confirmed', types: '', dated_periods: '' },
      t,
    )
    expect(html).not.toContain('hillfort.area')
    expect(html).not.toContain('hillfort.altitude')
    expect(html).not.toContain('hillfort.dated')
  })

  it('ignores a type, country or period it has no word for, and escapes the name', () => {
    const html = buildHillfortPopupHtml(
      {
        name: '<b>x</b>',
        country: 'Atlantis',
        types: 'moat',
        dated_periods: 'jurassic',
        reliability: 'confirmed',
      },
      t,
    )
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('type.moat')
    expect(html).not.toContain('country.atlantis')
    expect(html).not.toContain('jurassic')
  })

  it('covers every type and period the importer can write', () => {
    expect(HILLFORT_TYPES).toHaveLength(7)
    expect(Object.keys(HILLFORT_PERIOD_SPANS)).toHaveLength(7)
    // Spans must tile the timeline without a gap: each ends where the next begins.
    const spans = Object.values(HILLFORT_PERIOD_SPANS)
    for (let index = 1; index < spans.length; index++) {
      expect(spans[index]![0]).toBe(spans[index - 1]![1])
    }
  })
})

describe('the monument marks', () => {
  it('draw a glyph for every kind the database can hold', () => {
    expect(Object.keys(MONUMENT_ICON_GLYPHS).sort()).toEqual([...MONUMENT_KINDS].sort())
    for (const kind of MONUMENT_KINDS) {
      expect(MONUMENT_ICON_GLYPHS[kind].path.length).toBeGreaterThan(10)
    }
  })

  it('give every kind its own mark, except where the atlas already draws the same thing', () => {
    const paths = MONUMENT_KINDS.map((kind) => MONUMENT_ICON_GLYPHS[kind].path)
    expect(new Set(paths).size).toBe(MONUMENT_KINDS.length)
  })

  it('pick a mark per kind on the map, and fall back to the generic front for an unknown one', () => {
    const expression = buildMonumentIconExpression() as unknown[]
    expect(expression.slice(0, 2)).toEqual(['match', ['get', 'kind']])
    for (const kind of MONUMENT_KINDS) {
      const at = expression.indexOf(kind)
      expect(at).toBeGreaterThan(1)
      expect(expression[at + 1]).toBe(monumentIconId(kind))
    }
    expect(expression.at(-1)).toBe(MONUMENT_ICON_ID)
  })
})
