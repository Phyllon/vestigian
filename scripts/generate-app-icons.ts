/**
 * Rasterizes `public/favicon.svg` into the three PWA icon files
 * `public/manifest.webmanifest` has referenced since before this script
 * existed — `pnpm check`'s Lighthouse-adjacent checks don't catch a missing
 * icon file, so the manifest has been silently broken. Run by hand, output
 * committed, same pattern as `build-glyphs.ts` and `generate-og-placeholders.ts`.
 *
 *   pnpm icons:build
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const BACKGROUND = '#f2ede1'

const main = async (): Promise<void> => {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const publicDir = join(rootDir, 'public')
  const iconsDir = join(publicDir, 'icons')
  await mkdir(iconsDir, { recursive: true })

  const svg = await readFile(join(publicDir, 'favicon.svg'))

  const icon192 = await sharp(svg).resize(192, 192).png().toBuffer()
  await writeFile(join(iconsDir, 'icon-192.png'), icon192)
  console.log('wrote public/icons/icon-192.png')

  const icon512 = await sharp(svg).resize(512, 512).png().toBuffer()
  await writeFile(join(iconsDir, 'icon-512.png'), icon512)
  console.log('wrote public/icons/icon-512.png')

  // Maskable icons are cropped to a circle (or squircle, or rounded square)
  // by the OS, so content has to sit inside the middle "safe zone" the W3C
  // spec defines as an 80%-diameter circle — the artwork is rendered at 80%
  // and centred on a full-bleed background square rather than resized to
  // fill the canvas, so nothing is clipped on a round icon.
  const artworkSize = Math.round(512 * 0.8)
  const artwork = await sharp(svg).resize(artworkSize, artworkSize).png().toBuffer()
  const offset = Math.round((512 - artworkSize) / 2)
  const maskable = await sharp({
    create: { width: 512, height: 512, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: artwork, left: offset, top: offset }])
    .png()
    .toBuffer()
  await writeFile(join(iconsDir, 'icon-maskable.png'), maskable)
  console.log('wrote public/icons/icon-maskable.png')
}

await main()
