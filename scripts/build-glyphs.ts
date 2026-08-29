/**
 * Renders a TTF into the SDF glyph ranges MapLibre asks for, under `public/`.
 *
 * Map labels used to be drawn with glyphs fetched from a public font server at
 * runtime, which sits badly beside the reason every interface font here is
 * self-hosted through `@fontsource`: reading the atlas should tell no third
 * party that you did. The output of this script is committed, so the app ships
 * its own labels and an antiquity view makes no third-party request at all.
 *
 * Run by hand, and approximately never — only when the fontstack changes. It
 * exists so that regeneration is reproducible rather than remembered.
 *
 *   curl -Lo NotoSans-Regular.ttf \
 *     https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf
 *   pnpm glyphs:build NotoSans-Regular.ttf
 *
 * The font must be redistributable and its licence committed beside the output;
 * Noto Sans is OFL 1.1, and `public/fonts/OFL.txt` is that obligation.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import fontnik from 'fontnik'

const renderRange = promisify(fontnik.range) as (options: {
  font: Buffer
  start: number
  end: number
}) => Promise<Buffer>

/**
 * Nine of the 256 possible ranges, not all of them, and not every range the
 * data touches either.
 *
 * MapLibre requests only the ranges holding characters it has to draw, so
 * shipping the rest would be two megabytes nobody fetches. These cover what
 * this atlas actually renders: Latin and its extensions, Greek and Cyrillic —
 * the imported records and the Barrington place names carry all three — plus
 * the punctuation and letterlike blocks where en-dashes, curly quotes and the
 * numero sign live.
 *
 * The imported site titles also contain Arabic, from the Levantine and North
 * African records. It is deliberately **not** here: this font is Noto Sans
 * latin-greek-cyrillic and has no Arabic glyphs, so generating the range would
 * ship a file full of nothing and MapLibre would draw nothing. A missing range
 * 404s instead, and MapLibre renders those codepoints locally from the system
 * font — which is how "صيدا" appears at all. An empty range would be worse
 * than the absent one.
 */
const RANGES = [
  { start: 0, end: 255 }, // Basic Latin, Latin-1
  { start: 256, end: 511 }, // Latin Extended-A
  { start: 512, end: 767 }, // Latin Extended-B
  { start: 768, end: 1023 }, // Combining marks, Greek
  { start: 1024, end: 1279 }, // Cyrillic
  { start: 7680, end: 7935 }, // Latin Extended Additional
  { start: 7936, end: 8191 }, // Greek Extended
  { start: 8192, end: 8447 }, // General punctuation
  { start: 8448, end: 8703 }, // Letterlike symbols
]

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The directory name is the fontstack MapLibre asks for, so it has to match
 * `MAP_LABEL_FONT` exactly. A mismatch renders every label blank and logs
 * nothing that says why.
 */
const FONTSTACK = 'Noto Sans Regular'

const main = async (): Promise<void> => {
  const source = process.argv[2]

  if (!source) {
    throw new Error('Name the TTF to render, e.g. pnpm glyphs:build NotoSans-Regular.ttf')
  }

  const font = await readFile(source)
  const target = join(projectRoot, 'public', 'fonts', FONTSTACK)
  await mkdir(target, { recursive: true })

  let written = 0

  for (const range of RANGES) {
    const glyphs = await renderRange({ font, start: range.start, end: range.end })
    await writeFile(join(target, `${range.start}-${range.end}.pbf`), glyphs)
    written += glyphs.byteLength
  }

  console.log(
    `Wrote ${RANGES.length} ranges (${Math.round(written / 1024)} KB) to public/fonts/${FONTSTACK}/.\n` +
      `Commit them, and commit the font's licence beside them if it is not already there.`,
  )
}

await main()
