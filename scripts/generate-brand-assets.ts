/**
 * Writes every static SVG that carries the Vestigian mark, from the one
 * definition in `scripts/brand/vestigian-mark.ts`:
 *
 *   public/brand/vestigian-mark.svg       the mark alone, transparent
 *   public/favicon.svg                    the mark on the paper plate (the source
 *                                         `icons:build` rasterises for the PWA icons)
 *   public/partner-assets/badge/*.svg           the "Seen on Vestigian" badge, one per
 *                                         interface language
 *
 * Run by hand, output committed, like `og:build` and `icons:build`. `brand:build`
 * runs all three in order.
 *
 *   pnpm brand:build
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INK, PAPER, WINE_RED, buildMarkGroup, buildMarkSvg } from './brand/vestigian-mark'

/** What the badge says, per interface language. Keep in step with `partnersPage.badgeAlt`. */
const BADGE_TEXT: Record<string, string> = {
  en: 'Seen on Vestigian',
  de: 'Zu sehen auf Vestigian',
  fr: 'Vu sur Vestigian',
  es: 'Visto en Vestigian',
  it: 'Visto su Vestigian',
  nl: 'Te zien op Vestigian',
}

const BADGE_WIDTH = 220
const BADGE_HEIGHT = 40

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const buildFavicon =
  (): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Vestigian">
  <title>Vestigian</title>
  <rect width="64" height="64" rx="8" fill="${PAPER}"/>
  ${buildMarkGroup({ x: 6, y: 6, size: 52 })}
</svg>
`

/**
 * A plate of its own: the badge sits on other people's pages, whatever their
 * ground, so it carries its own paper and a hairline of ink. The serif is a
 * fallback stack, not Fraunces — a standalone SVG on someone else's site has no
 * web font to draw on.
 */
const buildBadge = (
  text: string,
): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BADGE_WIDTH} ${BADGE_HEIGHT}" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" role="img" aria-label="${escapeXml(text)}">
  <title>${escapeXml(text)}</title>
  <rect x="0.5" y="0.5" width="${BADGE_WIDTH - 1}" height="${BADGE_HEIGHT - 1}" rx="3" fill="${PAPER}" stroke="${INK}"/>
  ${buildMarkGroup({ x: 8, y: 5, size: 30 })}
  <text x="46" y="25.5" font-family="Georgia, 'Times New Roman', serif" font-size="15" fill="${INK}">${escapeXml(text)}</text>
  <rect x="${BADGE_WIDTH - 5}" y="9" width="2" height="22" fill="${WINE_RED}"/>
</svg>
`

const main = async (): Promise<void> => {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
  await mkdir(join(publicDir, 'brand'), { recursive: true })
  await mkdir(join(publicDir, 'partner-assets', 'badge'), { recursive: true })

  await writeFile(join(publicDir, 'brand', 'vestigian-mark.svg'), buildMarkSvg())
  console.log('wrote public/brand/vestigian-mark.svg')

  await writeFile(join(publicDir, 'favicon.svg'), buildFavicon())
  console.log('wrote public/favicon.svg')

  for (const [code, text] of Object.entries(BADGE_TEXT)) {
    await writeFile(
      join(publicDir, 'partner-assets', 'badge', `seen-on-vestigian.${code}.svg`),
      buildBadge(text),
    )
    console.log(`wrote public/partner-assets/badge/seen-on-vestigian.${code}.svg`)
  }
}

await main()
