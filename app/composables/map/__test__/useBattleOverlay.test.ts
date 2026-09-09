import { describe, expect, it } from 'vitest'
import {
  BATTLE_LAYER_ID,
  buildBattleLayer,
  buildBattlePopupHtml,
  escapeHtmlForPopup,
} from '../useBattleOverlay'

const t = (key: string, params?: Record<string, unknown>): string => {
  if (key === 'limesFormat.bc') return `${params?.year} BC`
  if (key === 'limesFormat.ad') return `AD ${params?.year}`
  if (key === 'battlePopup.viewOnWikipedia') return 'View on Wikipedia'
  if (key === 'battlePopup.viewOnWikidata') return 'View on Wikidata'
  if (key === 'battlePopup.locationApproximate') return 'Location is approximate'
  return key
}

const baseProperties = {
  title: 'Battle of Cannae',
  year: -216,
  wikidata_id: 'Q193562',
  location_precision: 'precise' as const,
  wikipedia_url: null,
}

describe('buildBattleLayer', () => {
  it('draws a single fixed icon, needing no match expression', () => {
    // Unlike the site/limes marks, there is only one kind of thing to draw
    // here — a plain icon id, not a `match` on some category field.
    const layer = buildBattleLayer()
    expect(layer.id).toBe(BATTLE_LAYER_ID)
    expect(layer.type).toBe('symbol')
    expect(layer.layout?.['icon-image']).toBe('vestigian-battle')
  })

  it('reads the battles source layer, not atlas or limes', () => {
    const layer = buildBattleLayer()
    expect(layer.source).toBe('battles')
    expect(layer['source-layer']).toBe('battles')
  })
})

describe('buildBattlePopupHtml', () => {
  it('names the battle and its year', () => {
    const html = buildBattlePopupHtml(baseProperties, t)
    expect(html).toContain('Battle of Cannae')
    expect(html).toContain('216 BC')
  })

  it('formats a CE year without a sign', () => {
    const html = buildBattlePopupHtml(
      { ...baseProperties, title: 'Battle of Actium', year: -31 },
      t,
    )
    expect(html).toContain('31 BC')

    const ce = buildBattlePopupHtml({ ...baseProperties, title: 'A battle', year: 9 }, t)
    expect(ce).toContain('AD 9')
  })

  it('links to Wikipedia only when a link exists', () => {
    const withLink = buildBattlePopupHtml(
      {
        ...baseProperties,
        title: 'Battle of Alesia',
        year: -52,
        wikipedia_url: 'https://en.wikipedia.org/wiki/Battle_of_Alesia',
      },
      t,
    )
    expect(withLink).toContain('href="https://en.wikipedia.org/wiki/Battle_of_Alesia"')
    expect(withLink).toContain('View on Wikipedia')

    const withoutLink = buildBattlePopupHtml(
      { ...baseProperties, title: 'Unlinked battle', year: -100 },
      t,
    )
    expect(withoutLink).not.toContain('View on Wikipedia')
  })

  it('always links to Wikidata, every battle carries an id', () => {
    const html = buildBattlePopupHtml({ ...baseProperties, wikidata_id: 'Q127330' }, t)
    expect(html).toContain('href="https://www.wikidata.org/wiki/Q127330"')
    expect(html).toContain('View on Wikidata')
  })

  it("notes an approximate location only when Wikidata's own precision is rough", () => {
    const precise = buildBattlePopupHtml({ ...baseProperties, location_precision: 'precise' }, t)
    expect(precise).not.toContain('Location is approximate')

    const rough = buildBattlePopupHtml({ ...baseProperties, location_precision: 'rough' }, t)
    expect(rough).toContain('Location is approximate')
  })

  it('escapes a title before it reaches setHTML, unlike a Vue template', () => {
    const html = buildBattlePopupHtml(
      { ...baseProperties, title: '<script>alert(1)</script>', year: -1 },
      t,
    )
    expect(html).not.toContain('<script>')
  })
})

describe('escapeHtmlForPopup', () => {
  it('escapes the five characters that matter in HTML text and attributes', () => {
    expect(escapeHtmlForPopup(`<>&"'`)).toBe('&#60;&#62;&#38;&#34;&#39;')
  })
})
