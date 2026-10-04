import { describe, expect, it } from 'vitest'
import type {
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import type { PeriodExtentColours } from '../useBasemapStyle'
import {
  POLITY_SOURCE_ID,
  buildPeriodExtentLayers,
  buildPolityLayers,
  resolvePeriodExtentColours,
  resolvePolityColours,
} from '../useBasemapStyle'
import { buildPolityPopupHtml } from '../usePeriodOverlay'

const layerIds = (colours?: PeriodExtentColours): string[] =>
  buildPeriodExtentLayers(colours).map((layer) => layer.id)

const layer = (id: string, colours?: PeriodExtentColours) =>
  buildPeriodExtentLayers(colours).find((entry) => entry.id === id)

describe('buildPeriodExtentLayers', () => {
  it('draws a fill, its own outline and the state name, all reading the generic period source', () => {
    // `usePeriodOverlay` adds this source itself, keyed to whichever year the
    // scrubber is on — the layer specs here are source-agnostic beyond that.
    const ids = layerIds()
    expect(ids).toEqual([
      'atlas-period-extent',
      'atlas-period-extent-casing',
      'atlas-period-extent-outline',
      'atlas-period-extent-label',
    ])
    for (const id of ids) {
      const entry = layer(id)
      expect(entry && 'source' in entry ? entry.source : undefined).toBe('atlas-period')
    }
  })

  it('defaults to a wash distinct from urban fill and infrastructure oxide', () => {
    // The whole point of a third colour: this fill has to read as "territory
    // at this date" without being mistaken for a city or a built structure.
    const fill = layer('atlas-period-extent') as FillLayerSpecification
    const outline = layer('atlas-period-extent-outline') as LineLayerSpecification
    expect(fill.paint?.['fill-color']).toBe('#c99b52')
    expect(outline.paint?.['line-color']).toBe('#6b4d17')
    expect(outline.paint?.['line-dasharray']).toEqual([5, 2.5])
    expect(fill.paint?.['fill-opacity']).toBeGreaterThanOrEqual(0.4)
  })

  it('names the state over its territory, in the tone of its own outline', () => {
    const label = layer('atlas-period-extent-label') as SymbolLayerSpecification
    expect(label.layout?.['text-field']).toEqual(['get', 'state_name'])
    expect(label.layout?.['text-transform']).toBe('uppercase')
    expect(label.paint?.['text-color']).toBe('#5a4216')
    expect(label.paint?.['text-halo-color']).toBe('#faf7ef')
  })

  it('draws whatever palette it is given, for the basemaps that need their own', () => {
    const colours: PeriodExtentColours = {
      fill: '#123456',
      line: '#654321',
      casing: '#dddddd',
      label: '#111111',
      halo: '#eeeeee',
    }
    const fill = layer('atlas-period-extent', colours) as FillLayerSpecification
    const outline = layer('atlas-period-extent-outline', colours) as LineLayerSpecification
    expect(fill.paint?.['fill-color']).toBe('#123456')
    expect(outline.paint?.['line-color']).toBe('#654321')
  })
})

describe('resolvePeriodExtentColours', () => {
  it('darkens the fill over DARE, whose own cartography is pale parchment', () => {
    const colours = resolvePeriodExtentColours('antiquity-dare')
    expect(colours).not.toEqual(resolvePeriodExtentColours('vestigian'))
    // Dark enough to read against a pale sheet — not just "different".
    expect(colours.fill.toLowerCase()).toMatch(/^#[0-2]/)
  })

  it('reaches for the one accent — oxide red — over satellite imagery', () => {
    // Same reasoning `SATELLITE_REFERENCE_INK` already documents for point
    // marks: real photography carries no single background tone, so the
    // default amber wash reads poorly against both dark and pale ground.
    expect(resolvePeriodExtentColours('satellite').fill).toBe('#9a3b22')
  })

  it('gives the night notebook a pale name with a dark halo, and only there', () => {
    const night = resolvePeriodExtentColours('vestigian', true)
    expect(night.label).not.toBe(resolvePeriodExtentColours('vestigian').label)
    expect(night.halo).toBe('#1c1610')
    expect(resolvePeriodExtentColours('antiquity-awmc', true)).toEqual(
      resolvePeriodExtentColours('antiquity-awmc'),
    )
  })

  it('keeps the default wash everywhere else', () => {
    expect(resolvePeriodExtentColours('vestigian')).toEqual(
      resolvePeriodExtentColours('antiquity-awmc'),
    )
  })
})

describe('buildPolityLayers', () => {
  const layers = buildPolityLayers()

  it('draws a fill, a casing, an outline and a name, all from the polity source', () => {
    expect(layers.map((entry) => entry.id)).toEqual([
      'atlas-polity-fill',
      'atlas-polity-casing',
      'atlas-polity-outline',
      'atlas-polity-label',
    ])
    for (const entry of layers) {
      expect('source' in entry && entry.source).toBe(POLITY_SOURCE_ID)
      expect('source-layer' in entry && entry['source-layer']).toBe('polities')
    }
  })

  it('is drawn with real weight — a solid fill, a casing under a dashed outline', () => {
    // Raised on request ("increase contrast a lot"): a fill under 0.3 and a thin
    // single stroke were invisible on every sheet.
    const fill = layers[0] as FillLayerSpecification
    const casing = layers[1] as LineLayerSpecification
    const outline = layers[2] as LineLayerSpecification
    expect(fill.paint?.['fill-opacity']).toBeGreaterThanOrEqual(0.3)
    expect(casing.paint?.['line-dasharray']).toBeUndefined()
    expect(outline.paint?.['line-dasharray']).toEqual([3, 2])
    expect(outline.paint?.['line-opacity']).toBeUndefined()
  })

  it('gives every sheet its own palette, with a night one for the modern basemap', () => {
    const palettes = [
      resolvePolityColours('vestigian'),
      resolvePolityColours('vestigian', true),
      resolvePolityColours('antiquity-dare'),
      resolvePolityColours('satellite'),
    ]
    expect(new Set(palettes.map((colours) => colours.fill)).size).toBe(4)
    expect(resolvePolityColours('antiquity-awmc', true)).toEqual(resolvePolityColours('vestigian'))
  })

  it('is a different hue from the Roman extent, which is amber', () => {
    expect(resolvePolityColours('vestigian').fill).not.toBe(
      resolvePeriodExtentColours('vestigian').fill,
    )
  })

  it('switches to white with a dark halo over satellite imagery, which has no stable tone', () => {
    const colours = resolvePolityColours('satellite')
    expect(colours.label).toBe('#ffffff')
    expect(colours.halo).not.toBe(colours.label)
  })
})

describe('buildPolityPopupHtml', () => {
  const t = (key: string, named?: Record<string, unknown>): string =>
    key === 'polityPopup.outline' ? `Outline for ${named?.period}` : key

  const properties = {
    name: 'Carthage',
    from_year: -264,
    to_year: -241,
    wikidata_id: 'Q2429397',
    wikipedia_title: 'Ancient Carthage',
  }

  it('links Wikipedia and Wikidata from a page phrase and an id, never from a stored URL', () => {
    const html = buildPolityPopupHtml(properties, t)
    expect(html).toContain('https://en.wikipedia.org/wiki/Ancient_Carthage')
    expect(html).toContain('https://www.wikidata.org/wiki/Q2429397')
    expect(html).toContain('polityPopup.caveat')
  })

  it('escapes the name and refuses a malformed id', () => {
    const html = buildPolityPopupHtml(
      {
        ...properties,
        name: '<script>x</script>',
        wikidata_id: 'Q1" onclick="x',
        wikipedia_title: null,
      },
      t,
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('wikidata.org')
  })
})
