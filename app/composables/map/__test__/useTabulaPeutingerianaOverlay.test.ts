import { describe, expect, it } from 'vitest'
import { resolveTabulaPeutingerianaColours } from '../useTabulaPeutingerianaOverlay'

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
