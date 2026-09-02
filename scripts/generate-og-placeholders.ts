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

const WIDTH = 1200
const HEIGHT = 630

const PAPER = '#f2ede1'
const INK = '#1c1815'
const OXIDE = '#9a3b22'

interface OgCard {
  filename: string
  label: string
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
  { filename: 'default.png', label: 'Vestigian' },
]

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const buildCardSvg = (label: string): string => `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}" />
  <rect x="0" y="0" width="16" height="${HEIGHT}" fill="${OXIDE}" />
  <text
    x="96" y="${HEIGHT / 2 - 20}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="88"
    fill="${INK}"
  >${escapeXml(label)}</text>
  <text
    x="96" y="${HEIGHT / 2 + 60}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="34"
    letter-spacing="4"
    fill="${OXIDE}"
  >VESTIGIAN</text>
</svg>
`

const main = async (): Promise<void> => {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og')
  await mkdir(outDir, { recursive: true })

  for (const card of CARDS) {
    const png = await sharp(Buffer.from(buildCardSvg(card.label)))
      .png()
      .toBuffer()
    await writeFile(join(outDir, card.filename), png)
    console.log(`wrote public/og/${card.filename}`)
  }
}

await main()
