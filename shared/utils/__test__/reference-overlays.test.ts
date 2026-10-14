import { describe, expect, it } from 'vitest'
import { REFERENCE_OVERLAY_IDS, isReferenceOverlayId } from '../reference-overlays'

describe('reference overlay ids', () => {
  it('lists each layer once, so the server and the interface agree on the set', () => {
    expect(new Set(REFERENCE_OVERLAY_IDS).size).toBe(REFERENCE_OVERLAY_IDS.length)
    expect([...REFERENCE_OVERLAY_IDS].sort()).toEqual([
      'hillforts',
      'isicily',
      'mints',
      'monuments',
      'road-audit',
      'roman-roads',
    ])
  })

  it('narrows a string only when it is one of them', () => {
    expect(isReferenceOverlayId('mints')).toBe(true)
    expect(isReferenceOverlayId('Mints')).toBe(false)
    expect(isReferenceOverlayId('toString')).toBe(false)
  })
})
