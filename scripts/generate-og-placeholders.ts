/**
 * One static Open Graph card per site category, plus one for tracings and one
 * site-wide default — for the (common, at this data scale) case where an
 * entity has no photograph to redirect to (`site_images` has no FK to
 * `tracings`, and many sites carry no approved image at all).
 *
 * Rendered from an inline SVG through sharp (already a dependency, used
 * elsewhere for the upload pipeline) rather than a headless-browser or
 * Satori/resvg renderer — no per-entity text is baked in, so a fixed set of
 * cards fully satisfies the Open Graph protocol's only real requirement (a
 * reachable, correctly sized image). Run by hand, output committed under
 * `public/og/`, same pattern as `build-glyphs.ts`.
 *
 *   pnpm og:build
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { INK, PAPER, WINE_RED, buildMarkGroup } from './brand/vestigian-mark'

const WIDTH = 1200
const HEIGHT = 630

interface OgCard {
  filename: string
  label: string
  /** Under the label. The wordmark by default; the default card says what the atlas is. */
  subtitle?: string
}

const SITE_CATEGORY_LABELS: Record<string, string> = {
  settlement: 'Settlement',
  fortification: 'Fortification',
  sanctuary: 'Sanctuary',
  burial: 'Burial',
  infrastructure: 'Infrastructure',
  villa: 'Villa',
  production: 'Production',
  findspot: 'Findspot',
  other: 'Site',
}

const CARDS: OgCard[] = [
  ...Object.entries(SITE_CATEGORY_LABELS).map(([category, label]) => ({
    filename: `${category}.png`,
    label,
  })),
  { filename: 'tracing.png', label: 'Tracing' },
  {
    filename: 'default.png',
    label: 'Vestigian',
    subtitle: 'An atlas of the traces antiquity left behind.',
  },
]

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The mark stands large on the right, where a feed thumbnail still reads it, and
 * the label with the wordmark beneath sit on the left: one wine-red shape and one
 * wine-red line on a card, as on a page. Georgia is a fallback stack — sharp's SVG
 * renderer has no web font to draw on, and a card has no per-entity text to get
 * wrong.
 */
const buildCardSvg = ({ label, subtitle }: Pick<OgCard, 'label' | 'subtitle'>): string => {
  const isWordmark = subtitle === undefined
  const sub = escapeXml(subtitle ?? 'VESTIGIAN')
  const subSize = isWordmark ? 34 : 32
  const spacing = isWordmark ? 4 : 0
  return `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}" />
  ${buildMarkGroup({ x: 780, y: 110, size: 360 })}
  <text
    x="96" y="${HEIGHT / 2 + 6}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="96"
    fill="${INK}"
  >${escapeXml(label)}</text>
  <text
    x="96" y="${HEIGHT / 2 + 84}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="${subSize}"
    letter-spacing="${spacing}"
    fill="${WINE_RED}"
  >${sub}</text>
</svg>
`
}

const main = async (): Promise<void> => {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og')
  await mkdir(outDir, { recursive: true })

  for (const card of CARDS) {
    const png = await sharp(Buffer.from(buildCardSvg(card)))
      .png()
      .toBuffer()
    await writeFile(join(outDir, card.filename), png)
    console.log(`wrote public/og/${card.filename}`)
  }
}

await main()
