import { describe, expect, it } from 'vitest'
import {
  INSCRIPTION_LAYER_ID,
  buildInscriptionLayer,
  buildInscriptionPopupHtml,
  type InscriptionFeatureProperties,
} from '../useInscriptionsOverlay'

const t = (key: string, params?: Record<string, unknown>): string => {
  if (key === 'periodFormat.bc') return `${params?.year} BC`
  if (key === 'periodFormat.ad') return `AD ${params?.year}`
  if (key === 'periodFormat.undated') return 'Undated'
  if (key === 'periodFormat.fromYear') return `From ${params?.year}`
  if (key === 'periodFormat.untilYear') return `Until ${params?.year}`
  if (key === 'periodFormat.yearRange') return `${params?.from} – ${params?.to}`
  if (key === 'epigraphy.types.funerary') return 'Funerary'
  if (key === 'epigraphy.popup.open') return 'Open inscription'
  return key
}

const baseProperties: InscriptionFeatureProperties = {
  edh_id: 'HD000001',
  title: 'Grabinschrift auf Tafel',
  inscription_type: 'funerary',
  material: 'Marmor',
  not_before: 71,
  not_after: 130,
}

describe('buildInscriptionLayer', () => {
  it('draws a single fixed icon, needing no match expression', () => {
    const layer = buildInscriptionLayer()
    expect(layer.id).toBe(INSCRIPTION_LAYER_ID)
    expect(layer.type).toBe('symbol')
    expect(layer.layout?.['icon-image']).toBe('vestigian-inscription')
  })

  it('reads the inscriptions source layer', () => {
    const layer = buildInscriptionLayer()
    expect(layer.source).toBe('inscriptions')
    expect(layer['source-layer']).toBe('inscriptions')
  })
})

describe('buildInscriptionPopupHtml', () => {
  it('names the inscription, its type, material and date range', () => {
    const html = buildInscriptionPopupHtml(baseProperties, t)
    expect(html).toContain('Grabinschrift auf Tafel')
    expect(html).toContain('Funerary')
    expect(html).toContain('Marmor')
    expect(html).toContain('AD 71 – AD 130')
  })

  it("links to the inscription's own detail page", () => {
    const html = buildInscriptionPopupHtml(baseProperties, t)
    expect(html).toContain('href="/inscriptions/HD000001"')
  })

  it('shows no date line at all for a genuinely undated inscription', () => {
    const html = buildInscriptionPopupHtml(
      { ...baseProperties, not_before: null, not_after: null },
      t,
    )
    expect(html).not.toContain('AD')
    expect(html).not.toContain('Undated')
  })

  it('never renders a bare "AD" for an MVT-decoded undated inscription', () => {
    // The exact bug this test exists for: MVT omits NULL columns from a
    // decoded feature's properties entirely, so a real map popup receives
    // `undefined`, not `null`, for both fields — not something a plain
    // object literal in a test can produce by simply typing `null`, so this
    // builds the object without the two keys at all, the shape a real tile
    // actually hands back.
    const undated = {
      edh_id: baseProperties.edh_id,
      title: baseProperties.title,
      inscription_type: baseProperties.inscription_type,
      material: baseProperties.material,
    } as InscriptionFeatureProperties

    const html = buildInscriptionPopupHtml(undated, t)
    const lines = html.split('<br>')
    expect(lines).not.toContain('AD')
  })

  it('falls back to the raw normalised type when there is no translation for it', () => {
    const html = buildInscriptionPopupHtml({ ...baseProperties, inscription_type: 'label' }, t)
    expect(html).toContain('label')
  })
})
