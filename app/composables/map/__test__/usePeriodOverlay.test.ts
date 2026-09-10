import { describe, expect, it } from 'vitest'
import type { FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl'
import type { PeriodExtentColours } from '../useBasemapStyle'
import { buildPeriodExtentLayers, resolvePeriodExtentColours } from '../useBasemapStyle'

const layerIds = (colours?: PeriodExtentColours): string[] =>
  buildPeriodExtentLayers(colours).map((layer) => layer.id)

const layer = (id: string, colours?: PeriodExtentColours) =>
  buildPeriodExtentLayers(colours).find((entry) => entry.id === id)

describe('buildPeriodExtentLayers', () => {
  it('draws a fill and its own outline, both reading the generic period source', () => {
    // `usePeriodOverlay` adds this source itself, keyed to whichever year the
    // scrubber is on — the layer specs here are source-agnostic beyond that.
    const ids = layerIds()
    expect(ids).toEqual(['atlas-period-extent', 'atlas-period-extent-outline'])
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
    expect(outline.paint?.['line-color']).toBe('#8a6a2f')
  })

  it('draws whatever palette it is given, for the basemaps that need their own', () => {
    const colours: PeriodExtentColours = { fill: '#123456', line: '#654321' }
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

  it('keeps the default wash everywhere else', () => {
    expect(resolvePeriodExtentColours('vestigian')).toEqual(
      resolvePeriodExtentColours('antiquity-awmc'),
    )
  })
})
