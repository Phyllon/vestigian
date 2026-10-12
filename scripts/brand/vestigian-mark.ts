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
 * this is the mark's own colour. It lives on its own plate (the favicon, the share
 * cards, the badge), so no dark-mode variant is needed; if the mark is ever set
 * straight onto the night ground it wants a lighter wine, which is a decision, not
 * an inversion.
 *
 * Every asset that carries it is written from here by
 * `scripts/generate-brand-assets.ts` and `scripts/generate-og-placeholders.ts`, so
 * the geometry exists once. See `.claude/rules/brand-and-share-assets.md`.
 */
export const WINE_RED = '#7a1f2f'
export const PAPER = '#f2ede1'
export const INK = '#1c1815'

/** The mark is drawn on a 64-unit square, like the favicon always was. */
export const MARK_VIEWBOX = 64

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

const format = (value: number): string => String(Math.round(value * 100) / 100)

const polygon = (points: readonly (readonly [number, number])[]): string => {
  const vertices = points.map(([x, y]) => [format(x + OFFSET_X), format(y)].join(' '))
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

export interface MarkPlacement {
  /** Left edge of the mark's square, in the host SVG's units. */
  x: number
  y: number
  /** Edge length of the mark's square, in the host SVG's units. */
  size: number
  fill?: string
}

/** The mark as a `<g>`, placed and scaled inside another SVG. */
export const buildMarkGroup = ({ x, y, size, fill = WINE_RED }: MarkPlacement): string => {
  const scale = size / MARK_VIEWBOX
  const paths = buildMarkPaths()
    .map((data) => `<path d="${data}"/>`)
    .join('')
  const scaleText = String(Math.round(scale * 10000) / 10000)
  return `<g transform="translate(${format(x)} ${format(y)}) scale(${scaleText})" fill="${fill}">${paths}</g>`
}

/** A standalone SVG of the mark, transparent ground. */
export const buildMarkSvg = (fill: string = WINE_RED): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}" role="img" aria-label="Vestigian"><title>Vestigian</title><g fill="${fill}">${buildMarkPaths()
    .map((data) => `<path d="${data}"/>`)
    .join('')}</g></svg>\n`
