import { describe, expect, it } from 'vitest'
import {
  FEATURE_LAYER_ID,
  buildFeatureLayer,
  buildFeaturePopupHtml,
} from '../useMinorFeatureOverlay'

const t = (key: string): string => {
  const labels: Record<string, string> = {
    'minorFeaturePopup.kind.bridge': 'Bridge',
    'minorFeaturePopup.kind.mine_quarry': 'Mine or quarry',
    'minorFeaturePopup.kind.fort': 'Fort',
  }
  return labels[key] ?? key
}

describe('buildFeatureLayer', () => {
  it('matches every minor feature kind to its own icon', () => {
    const layer = buildFeatureLayer()
    expect(layer.id).toBe(FEATURE_LAYER_ID)
    expect(layer.type).toBe('symbol')
    const expression = layer.layout?.['icon-image']
    expect(expression).toContain('bridge')
    expect(expression).toContain('mine_quarry')
  })

  it('reads the features source layer, not atlas or limes', () => {
    const layer = buildFeatureLayer()
    expect(layer.source).toBe('features')
    expect(layer['source-layer']).toBe('features')
  })
})

describe('buildFeaturePopupHtml', () => {
  it('falls back to the kind label when the source carries no name', () => {
    const html = buildFeaturePopupHtml(
      { kind: 'bridge', name: null, source: 'BAtlas_22', material: null, periods: 'Roman' },
      t,
    )
    expect(html).toContain('<strong>Bridge</strong>')
    expect(html).toContain('Roman')
    expect(html).toContain('BAtlas_22')
  })

  it('leads with the name when one exists, and still shows the kind', () => {
    const html = buildFeaturePopupHtml(
      { kind: 'mine_quarry', name: null, source: null, material: 'Fe', periods: null },
      t,
    )
    expect(html).toContain('Iron')
    expect(html).toContain('Mine or quarry')
  })

  it('expands a material abbreviation code, including multi-commodity rows', () => {
    const html = buildFeaturePopupHtml(
      { kind: 'mine_quarry', name: null, source: null, material: 'Au, Fe', periods: null },
      t,
    )
    expect(html).toContain('Gold, Iron')
  })

  it('shows an unrecognised material code verbatim rather than guessing', () => {
    const html = buildFeaturePopupHtml(
      { kind: 'mine_quarry', name: null, source: null, material: 'Cn', periods: null },
      t,
    )
    expect(html).toContain('Cn')
  })

  it('expands a period letter code, marking an uncertain attestation', () => {
    const html = buildFeaturePopupHtml(
      { kind: 'mine_quarry', name: null, source: null, material: null, periods: 'H?R?' },
      t,
    )
    expect(html).toContain('Hellenistic (uncertain), Roman (uncertain)')
  })

  it('leaves an already-expanded bridge period string untouched', () => {
    const html = buildFeaturePopupHtml(
      { kind: 'bridge', name: null, source: null, material: null, periods: 'Archaic, Roman' },
      t,
    )
    expect(html).toContain('Archaic, Roman')
  })

  it('escapes a source citation before it reaches setHTML', () => {
    const html = buildFeaturePopupHtml(
      {
        kind: 'fort',
        name: '<script>alert(1)</script>',
        source: null,
        material: null,
        periods: null,
      },
      t,
    )
    expect(html).not.toContain('<script>')
  })
})
