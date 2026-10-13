import { describe, expect, it } from 'vitest'
import { recordSheetClearance, recordSheetPadding } from '../record-sheet'

describe('recordSheetPadding', () => {
  it('leaves the upper quarter of a phone clear of the sheet that rises from below', () => {
    const padding = recordSheetPadding({ mapHeight: 600, isCompact: true })
    expect(padding.bottom).toBe(456)
    expect(padding.right).toBe(24)
  })

  it('leaves the left of a wide screen clear of the sheet standing at its right edge', () => {
    const padding = recordSheetPadding({ mapHeight: 800, isCompact: false })
    expect(padding.right).toBe(440)
    expect(padding.bottom).toBe(24)
  })

  it('always clears the control row along the top', () => {
    expect(recordSheetPadding({ mapHeight: 600, isCompact: true }).top).toBe(70)
    expect(recordSheetPadding({ mapHeight: 600, isCompact: false }).top).toBe(70)
  })
})

describe('recordSheetClearance', () => {
  it('leaves the band above the 78%-of-window sheet on a phone', () => {
    // 667px window, 57px header: a 610px map, the sheet 520px tall.
    const padding = recordSheetClearance({
      viewportHeight: 667,
      mapHeight: 610,
      isSheetAtBottom: true,
    })
    expect(padding.bottom).toBe(520)
    expect(padding.top).toBe(56)
    // What is left, and so where the mark's centre will be: 56..90.
    expect(610 - padding.bottom - padding.top).toBeGreaterThan(20)
  })

  it('never lets the sheet take the whole map', () => {
    const padding = recordSheetClearance({
      viewportHeight: 400,
      mapHeight: 350,
      isSheetAtBottom: true,
    })
    expect(350 - padding.bottom - padding.top).toBeGreaterThanOrEqual(20)
  })

  it('centres on the part left of a side sheet on a wide screen', () => {
    expect(
      recordSheetClearance({ viewportHeight: 800, mapHeight: 744, isSheetAtBottom: false }),
    ).toEqual({ top: 0, left: 0, right: 416, bottom: 0 })
  })
})
