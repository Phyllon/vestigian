import { describe, expect, it } from 'vitest'
import {
  buildTabulaRoadPopupHtml,
  resolveTabulaPeutingerianaColours,
  type TabulaPopupHelpers,
  type TabulaRoadFeatureProperties,
} from '../useTabulaPeutingerianaOverlay'

describe('resolveTabulaPeutingerianaColours', () => {
  it('moves off verdigris and adds a casing over satellite imagery, where green line on woodland is lost', () => {
    const satellite = resolveTabulaPeutingerianaColours('satellite')
    const sheet = resolveTabulaPeutingerianaColours('vestigian')
    expect(satellite.line).not.toBe(sheet.line)
    expect(satellite.casing).not.toBeNull()
  })

  it('keeps the verdigris, uncased, on every other basemap', () => {
    const sheet = resolveTabulaPeutingerianaColours('vestigian')
    expect(sheet.casing).toBeNull()
    expect(resolveTabulaPeutingerianaColours('antiquity-dare')).toEqual(sheet)
  })
})

describe('buildTabulaRoadPopupHtml', () => {
  const messages: Record<string, string> = {
    'tabulaPopup.noFigure': 'No distance on the manuscript',
    'tabulaPopup.stated': '{n} Roman miles stated (≈ {km} km)',
    'tabulaPopup.straightLine': 'Straight line, calculated: {km} km',
    'tabulaPopup.shorterThanLine': 'Shorter than the line',
    'tabulaPopup.roadWinds': 'A road winds',
    'tabulaPopup.overWater': 'Sea crossing',
    'tabulaPopup.crossesMountains': 'Crosses mountains',
    'tabulaPopup.crossesRiver': 'Crosses {river}',
    'tabulaPopup.reconstructed': 'Filled from the Itinerarium Antonini',
  }
  const helpers: TabulaPopupHelpers = {
    t: (key, values = {}) =>
      (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name])),
    formatKilometres: (kilometres) => kilometres.toFixed(1),
  }
  const leg: TabulaRoadFeatureProperties = {
    distanceRomanMiles: 16,
    isReconstructed: false,
    overWater: false,
    crossesMountains: false,
    crossesRiver: null,
    fromLabel: 'Roma',
    fromModernName: 'Rome',
    toLabel: 'Ostia',
    toModernName: null,
    straightLineMetres: 20000,
  }

  it('names both places, the modern name beside the classical one', () => {
    const html = buildTabulaRoadPopupHtml(leg, helpers)
    expect(html).toContain('Roma <span>(Rome)</span> → Ostia')
  })

  it('states the miles with their length in kilometres, and the calculated straight line', () => {
    const html = buildTabulaRoadPopupHtml(leg, helpers)
    expect(html).toContain('16 Roman miles stated (≈ 23.7 km)')
    expect(html).toContain('Straight line, calculated: 20.0 km')
    expect(html).toContain('A road winds')
  })

  it('flags only a figure shorter than the line', () => {
    const html = buildTabulaRoadPopupHtml({ ...leg, distanceRomanMiles: 5 }, helpers)
    expect(html).toContain('Shorter than the line')
    expect(html).not.toContain('A road winds')
  })

  it('says so when the manuscript carries no figure, and makes no comparison', () => {
    const html = buildTabulaRoadPopupHtml({ ...leg, distanceRomanMiles: null }, helpers)
    expect(html).toContain('No distance on the manuscript')
    expect(html).not.toContain('Shorter than the line')
  })

  it('lists crossings and the reconstructed flag', () => {
    const html = buildTabulaRoadPopupHtml(
      {
        ...leg,
        overWater: true,
        crossesMountains: true,
        crossesRiver: 'Fl. Padvs',
        isReconstructed: true,
      },
      helpers,
    )
    expect(html).toContain('Sea crossing · Crosses mountains · Crosses Fl. Padvs')
    expect(html).toContain('Filled from the Itinerarium Antonini')
  })

  it('escapes a place name before it reaches setHTML', () => {
    const html = buildTabulaRoadPopupHtml({ ...leg, fromLabel: '<img onerror=x>' }, helpers)
    expect(html).not.toContain('<img')
  })
})
