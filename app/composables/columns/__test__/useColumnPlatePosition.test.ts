import { describe, expect, it } from 'vitest'
import { clampPage, parseRememberedPages } from '../useColumnPlatePosition'

describe('parseRememberedPages', () => {
  it('reads a stored map of page positions', () => {
    expect(parseRememberedPages('{"trajans-column":12,"tafeln-i-lxiv":3}')).toEqual({
      'trajans-column': 12,
      'tafeln-i-lxiv': 3,
    })
  })

  it('treats an empty or absent value as nothing remembered', () => {
    expect(parseRememberedPages(null)).toEqual({})
    expect(parseRememberedPages('')).toEqual({})
  })

  it('discards a value that is not JSON rather than throwing', () => {
    expect(parseRememberedPages('not json at all')).toEqual({})
  })

  it('discards a JSON value that is not a flat object', () => {
    expect(parseRememberedPages('[1,2,3]')).toEqual({})
    expect(parseRememberedPages('null')).toEqual({})
    expect(parseRememberedPages('42')).toEqual({})
  })

  it('drops individual entries that are not whole, non-negative page indices', () => {
    const pages = parseRememberedPages(
      '{"ok":4,"negative":-1,"fractional":2.5,"text":"7","nested":{"page":1}}',
    )
    expect(pages).toEqual({ ok: 4 })
  })
})

describe('clampPage', () => {
  it('keeps a page that this volume actually has', () => {
    expect(clampPage(0, 64)).toBe(0)
    expect(clampPage(63, 64)).toBe(63)
  })

  /**
   * A re-import that drops a corrupt plate shortens the sequence, and landing
   * on the end of a volume you were in the middle of is more confusing than
   * starting again — so an out-of-range position reads as "none remembered",
   * never as the last plate.
   */
  it('forgets a page the volume no longer has', () => {
    expect(clampPage(80, 64)).toBe(0)
    expect(clampPage(64, 64)).toBe(0)
  })

  it('answers 0 when nothing is remembered or nothing is loaded', () => {
    expect(clampPage(undefined, 64)).toBe(0)
    expect(clampPage(5, 0)).toBe(0)
  })
})
