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
  return key
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
    const html = buildBattlePopupHtml(
      { title: 'Battle of Cannae', year: -216, wikipedia_url: null },
      t,
    )
    expect(html).toContain('Battle of Cannae')
    expect(html).toContain('216 BC')
  })

  it('formats a CE year without a sign', () => {
    const html = buildBattlePopupHtml(
      { title: 'Battle of Actium', year: -31, wikipedia_url: null },
      t,
    )
    expect(html).toContain('31 BC')

    const ce = buildBattlePopupHtml({ title: 'A battle', year: 9, wikipedia_url: null }, t)
    expect(ce).toContain('AD 9')
  })

  it('links to Wikipedia only when a link exists', () => {
    const withLink = buildBattlePopupHtml(
      {
        title: 'Battle of Alesia',
        year: -52,
        wikipedia_url: 'https://en.wikipedia.org/wiki/Battle_of_Alesia',
      },
      t,
    )
    expect(withLink).toContain('href="https://en.wikipedia.org/wiki/Battle_of_Alesia"')
    expect(withLink).toContain('View on Wikipedia')

    const withoutLink = buildBattlePopupHtml(
      { title: 'Unlinked battle', year: -100, wikipedia_url: null },
      t,
    )
    expect(withoutLink).not.toContain('href')
  })

  it('escapes a title before it reaches setHTML, unlike a Vue template', () => {
    const html = buildBattlePopupHtml(
      { title: '<script>alert(1)</script>', year: -1, wikipedia_url: null },
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
