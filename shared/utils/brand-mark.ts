/**
 * The Vestigian mark: a capital V whose right arm is solid and whose left arm
 * dissolves, slice by slice, towards the top — a trace that is fading out.
 *
 * It is "vestigia" read literally: the right stroke is what is still there, the
 * left is what the atlas is left to infer. The same idea the map already draws as
 * a dashed line wherever a course is approximate. Slices are cut horizontally, to
 * agree with the flat top and foot of the Roman capital the letter comes from, and
 * they narrow as they rise, so it is the letter — not a stripe — that reads at 16px.
 *
 * Wine red, not the oxide of the interface: the interface keeps one accent, and
 * this is the mark's own colour. On its own plates (the favicon, the share cards,
 * the badge) it is always on paper, so one colour serves; set straight onto the
 * night ground in the header it takes a lighter wine (`WINE_RED_ON_NIGHT`), which is
 * a decision, not an inversion.
 *
 * Every asset that carries it is written from here — the plates by
 * `scripts/generate-brand-assets.ts` and `scripts/generate-og-placeholders.ts`, the
 * header wordmark by `UiAppWordmark` — so the geometry exists once. It lives in
 * `shared/` because both the build scripts and the app read it. See
 * `.claude/rules/brand-and-share-assets.md`.
 */
export const WINE_RED = '#7a1f2f'

/**
 * The same mark on the night ground, where `WINE_RED` is 1.6:1 against the header
 * (`night-800`) and would vanish. A lighter wine of the same hue, 5.1:1 on night-800
 * and 3.1:1 on paper-50 — which is why the two are not one colour. Used by the
 * interface (`UiAppWordmark`), never by the plates, which are always paper.
 */
export const WINE_RED_ON_NIGHT = '#d4707f'

/** The mark is drawn on a 64-unit square, like the favicon always was. */
export const MARK_VIEWBOX = 64

/**
 * The letter's own bounds inside that square — `x y width height` — for setting it
 * in a line of text, where the square's empty margins would push it away from the
 * letters beside it. The foot sits exactly on the bottom edge, so the baseline of
 * a line lands on it.
 */
export const MARK_LETTER_VIEWBOX = '3.4 5.4 56.7 52.6'

const FOOT_Y = 58
const TOP_Y = 6
/** Shifts the drawing so its visual centre sits on the middle of the square. */
const OFFSET_X = 1.5

/** The left arm's centreline, from the vertex to the top of the letter. */
const LEFT_ARM = { x0: 31, y0: 62, x1: 5, y1: 6 }

/** Horizontal bands of the left arm, from the foot upwards, and their half-widths. */
const LEFT_BANDS: readonly { from: number; to: number; halfWidth: number }[] = [
  { from: FOOT_Y, to: 38, halfWidth: 4.6 },
  { from: 34, to: 22, halfWidth: 3.9 },
  { from: 18, to: 11, halfWidth: 3.2 },
  { from: 8, to: 5.5, halfWidth: 2.5 },
]

export const formatMarkNumber = (value: number): string => String(Math.round(value * 100) / 100)

const polygon = (points: readonly (readonly [number, number])[]): string => {
  const vertices = points.map(([x, y]) =>
    [formatMarkNumber(x + OFFSET_X), formatMarkNumber(y)].join(' '),
  )
  return `M${vertices.join(' L')} Z`
}

/** Path data for the right arm and each slice of the left, in the 64-unit square. */
export const buildMarkPaths = (): string[] => {
  const { x0, y0, x1, y1 } = LEFT_ARM
  const slope = (x1 - x0) / (y1 - y0)
  // x of the arm's centreline at a height; the perpendicular half-width is
  // widened to a horizontal one so the cut at a given y is exactly horizontal.
  const centreAt = (y: number): number => x0 + (y - y0) * slope
  const horizontalHalf = (halfWidth: number): number => halfWidth * Math.hypot(1, slope)

  const right = polygon([
    [34, FOOT_Y],
    [58.5, TOP_Y],
    [46.5, TOP_Y],
    [27, FOOT_Y],
  ])

  const slices = LEFT_BANDS.map(({ from, to, halfWidth }) => {
    const half = horizontalHalf(halfWidth)
    return polygon([
      [centreAt(from) - half, from],
      [centreAt(from) + half, from],
      [centreAt(to) + half, to],
      [centreAt(to) - half, to],
    ])
  })

  return [right, ...slices]
}
