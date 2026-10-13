/**
 * How much of the map a record's sheet covers, as camera padding.
 *
 * The detail sheet takes the lower part of a phone and the right-hand edge of a
 * desktop, so a mark centred on the map's own middle is hidden behind it. These
 * are the numbers the camera uses to leave a mark in the part that stays
 * visible. One definition, because "Fit it on the map" in a tower's panel and
 * the features page's "jump to the icon" must agree on what the sheet covers.
 */
export interface ScreenPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface RecordSheetPaddingInput {
  /** The map container's height in pixels. */
  mapHeight: number
  /** A handheld layout: the sheet rises from the bottom rather than standing at the side. */
  isCompact: boolean
}

/** The share of a phone's height the sheet takes when open. */
export const RECORD_SHEET_PHONE_SHARE = 0.76
/** The sheet's width on a wide screen, in pixels. */
export const RECORD_SHEET_DESKTOP_WIDTH_PIXELS = 440
/** The search row and the controls beside it, which float over the top of the map. */
const CONTROL_ROW_PIXELS = 70
const EDGE_PIXELS = 24

export const recordSheetPadding = ({
  mapHeight,
  isCompact,
}: RecordSheetPaddingInput): ScreenPadding => {
  if (isCompact) {
    return {
      top: CONTROL_ROW_PIXELS,
      left: EDGE_PIXELS,
      right: EDGE_PIXELS,
      bottom: Math.round(mapHeight * RECORD_SHEET_PHONE_SHARE),
    }
  }
  return {
    top: CONTROL_ROW_PIXELS,
    left: EDGE_PIXELS,
    right: RECORD_SHEET_DESKTOP_WIDTH_PIXELS,
    bottom: EDGE_PIXELS,
  }
}

export interface RecordSheetClearanceInput {
  /** The browser window's height: the sheet's own height is a share of this, not of the map's. */
  viewportHeight: number
  /** The map container's height in pixels. */
  mapHeight: number
  /** The sheet rises from the bottom (below Tailwind's `md`) rather than standing at the side. */
  isSheetAtBottom: boolean
}

/** The sheet's `max-h-[78vh]` on a phone (`SiteDetailPanel.vue`) — of the window, not the map. */
export const RECORD_SHEET_PHONE_MAX_VIEWPORT_SHARE = 0.78
/** The sheet's `md:w-[26rem]` at the side. */
export const RECORD_SHEET_SIDE_WIDTH_PIXELS = 416
/** Below the search field, which floats over the map's top edge on a phone. */
const SEARCH_ROW_CLEARANCE_PIXELS = 56
/** A band narrower than this is not somewhere a mark can be seen; the sheet wins the argument. */
const MIN_VISIBLE_BAND_PIXELS = 20

/**
 * Where a *single mark* can be put so that it is seen with the sheet open: the
 * middle of the part of the map the sheet leaves. Not the same question as
 * `recordSheetPadding`, which answers "how much room may a fitted box use" and
 * is deliberately generous so that a fit does not collapse to a few pixels.
 *
 * On a phone the sheet is up to 78% of the *window*, so on a 667px screen with a
 * header the map keeps a band of about 35px under the search field. That is
 * cramped and it is the true answer: this puts the mark's centre in it rather
 * than behind the sheet. A very short window falls back to a 20px band.
 */
export const recordSheetClearance = ({
  viewportHeight,
  mapHeight,
  isSheetAtBottom,
}: RecordSheetClearanceInput): ScreenPadding => {
  if (!isSheetAtBottom) {
    return { top: 0, left: 0, right: RECORD_SHEET_SIDE_WIDTH_PIXELS, bottom: 0 }
  }

  const top = SEARCH_ROW_CLEARANCE_PIXELS
  const sheetHeight = Math.round(viewportHeight * RECORD_SHEET_PHONE_MAX_VIEWPORT_SHARE)
  const bottom = Math.min(sheetHeight, Math.max(0, mapHeight - top - MIN_VISIBLE_BAND_PIXELS))
  return { top, left: 0, right: 0, bottom }
}
