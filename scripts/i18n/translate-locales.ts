import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Translate } from 'translate'

/**
 * Bootstraps the five non-English locale catalogues from `i18n/locales/en.json`
 * via the self-hosted LibreTranslate instance, once — not the per-request path
 * `server/utils/translate.ts` uses for enrichment text. UI chrome does not
 * change per visitor, so there is no reason to pay a translation call on every
 * page load for it; this produces static, checked-in JSON that a human can
 * edit afterward.
 *
 * ICU placeholders (`{name}`) are never sent to the translator at all — the
 * first version of this script substituted a token (`⟦0⟧`) around each one
 * and restored it afterward, on the assumption that an unrecognised symbol
 * would pass through untouched. It did not: against the real LibreTranslate
 * instance, "Select revision {id}" came back as "Selecteer revisie:" — the
 * token silently dropped, not mistranslated, so nothing about the output
 * looked wrong until something tried to interpolate into it. The model has no
 * reason to preserve a symbol it has never seen and no training signal telling
 * it that one matters. Splitting the string around each placeholder and
 * translating only the surrounding text — the placeholder itself spliced back
 * in verbatim, never part of any request — has no such failure mode, because
 * the model is never given the chance to drop what it was never shown.
 */

const LOCALES_DIR = fileURLToPath(new URL('../../i18n/locales/', import.meta.url))
const SOURCE_LOCALE = 'en'
const TARGET_LOCALES = ['fr', 'es', 'de', 'it', 'nl'] as const

const PLACEHOLDER_PATTERN = /\{[^}]+\}/g

export interface TextSegment {
  text: string
  isPlaceholder: boolean
}

/** "Select revision {id}" → [{"Select revision ", false}, {"{id}", true}]. */
export const splitOnPlaceholders = (text: string): TextSegment[] => {
  const segments: TextSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const index = match.index
    if (index > cursor) segments.push({ text: text.slice(cursor, index), isPlaceholder: false })
    segments.push({ text: match[0], isPlaceholder: true })
    cursor = index + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), isPlaceholder: false })

  return segments
}

/** Flattens `{ a: { b: 'c' } }` into `{ 'a.b': 'c' }`, the shape a translation pass and a diff both want. */
export const flatten = (value: unknown, prefix = ''): Record<string, string> => {
  const result: Record<string, string> = {}
  if (typeof value === 'string') {
    result[prefix] = value
    return result
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(result, flatten(child, prefix ? `${prefix}.${key}` : key))
    }
  }
  return result
}

export const unflatten = (flat: Record<string, string>): Record<string, unknown> => {
  const root: Record<string, unknown> = {}
  for (const [path, text] of Object.entries(flat)) {
    const segments = path.split('.')
    let cursor = root
    for (const segment of segments.slice(0, -1)) {
      const next = (cursor[segment] ??= {}) as Record<string, unknown>
      cursor = next
    }
    cursor[segments.at(-1) as string] = text
  }
  return root
}

const readJson = async (path: string): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Long enough for a cold model, short enough that one stuck call cannot hang
 * the whole script — this is exactly what was missing the first time this
 * ran: a request with no timeout raced against a LibreTranslate worker that
 * was itself timing out and restarting (see its container logs), and the
 * script sat waiting forever on one key with nothing written to show for it.
 */
const TRANSLATE_TIMEOUT_MS = 15000

/** Translates one segment of plain text — never called with a placeholder. */
const translateSegment = async (
  translator: ReturnType<typeof Translate>,
  text: string,
): Promise<string | null> => {
  try {
    const result = await Promise.race([
      translator(text),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TRANSLATE_TIMEOUT_MS)),
    ])
    return typeof result === 'string' && result.trim().length > 0 ? result : null
  } catch {
    return null
  }
}

/**
 * Translates the non-placeholder segments of `text` and splices the
 * placeholders back in untouched. A segment of only whitespace is passed
 * through as-is rather than sent to the translator — there is nothing in it
 * to translate, and asking risks an empty or null reply for no reason.
 * Returns null, falling the whole key back to English, if any segment that
 * did need translation could not be.
 */
const translateOne = async (
  translator: ReturnType<typeof Translate>,
  text: string,
): Promise<string | null> => {
  const segments = splitOnPlaceholders(text)
  const translated: string[] = []

  for (const segment of segments) {
    if (segment.isPlaceholder || segment.text.trim().length === 0) {
      translated.push(segment.text)
      continue
    }

    const result = await translateSegment(translator, segment.text)
    if (result === null) return null
    translated.push(result)
  }

  return translated.join('')
}

const main = async (): Promise<void> => {
  const translateUrl = process.env.NUXT_TRANSLATE_URL
  if (!translateUrl) {
    console.error('NUXT_TRANSLATE_URL is not set — nothing to translate against.')
    process.exitCode = 1
    return
  }

  const sourcePath = `${LOCALES_DIR}${SOURCE_LOCALE}.json`
  const source = await readJson(sourcePath)
  if (!source) {
    console.error(`Could not read ${sourcePath}.`)
    process.exitCode = 1
    return
  }
  const sourceFlat = flatten(source)

  for (const target of TARGET_LOCALES) {
    const targetPath = `${LOCALES_DIR}${target}.json`
    const existing = flatten((await readJson(targetPath)) ?? {})

    const translator = Translate({
      engine: 'libre',
      url: translateUrl,
      from: SOURCE_LOCALE,
      to: target,
    } as Parameters<typeof Translate>[0])

    const resultFlat: Record<string, string> = { ...existing }
    const emptyKeys: string[] = []
    let translatedCount = 0

    const pending = Object.entries(sourceFlat).filter(
      // Resumable: a key already translated to something other than the
      // English source is left alone rather than re-spent against the model.
      ([key, text]) => !(resultFlat[key] && resultFlat[key] !== text),
    )

    console.log(
      `${target}: translating ${pending.length} of ${Object.keys(sourceFlat).length} keys…`,
    )

    for (const [index, [key, text]] of pending.entries()) {
      process.stdout.write(`  [${index + 1}/${pending.length}] ${key}\r`)

      const translated = await translateOne(translator, text)
      if (translated) {
        resultFlat[key] = translated
        translatedCount += 1
      } else {
        resultFlat[key] = text
        emptyKeys.push(key)
      }

      // Written after every key, not once at the end of the language: a stuck
      // or interrupted run this way loses at most one in-flight translation
      // rather than the whole language, which is what happened here — `nl`
      // hung on its first call and the file never got written at all.
      await writeFile(targetPath, `${JSON.stringify(unflatten(resultFlat), null, 2)}\n`, 'utf-8')
    }

    console.log(
      `${' '.repeat(60)}\r${target}: ${translatedCount} translated, ${emptyKeys.length} left in English.`,
    )
    if (emptyKeys.length > 0) {
      console.log(`  needs a manual pass: ${emptyKeys.join(', ')}`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
