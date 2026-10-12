import {
  MARK_VIEWBOX,
  WINE_RED,
  buildMarkPaths,
  formatMarkNumber,
} from '../../shared/utils/brand-mark'

export { MARK_VIEWBOX, WINE_RED, buildMarkPaths }

/** The geometry is `shared/utils/brand-mark.ts`; this file draws it onto plates. */
export const PAPER = '#f2ede1'
export const INK = '#1c1815'

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
  return `<g transform="translate(${formatMarkNumber(x)} ${formatMarkNumber(y)}) scale(${scaleText})" fill="${fill}">${paths}</g>`
}

/** A standalone SVG of the mark, transparent ground. */
export const buildMarkSvg = (fill: string = WINE_RED): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}" role="img" aria-label="Vestigian"><title>Vestigian</title><g fill="${fill}">${buildMarkPaths()
    .map((data) => `<path d="${data}"/>`)
    .join('')}</g></svg>\n`
