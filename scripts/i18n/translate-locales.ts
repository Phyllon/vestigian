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

// `[^}]+` cannot overlap with itself or with the surrounding `{`/`}` literals,
// so this cannot backtrack super-linearly regardless of input.
// eslint-disable-next-line sonarjs/super-linear-regex
const PLACEHOLDER_PATTERN = /\{[^}]+\}/g

/**
 * Keys the translator never sees, in any language.
 *
 * Two kinds of string end up here. **Wordmarks** — the names external projects
 * and databases are actually called — must survive verbatim or they stop being
 * the name of anything: LibreTranslate has variously produced `Wikidonnées`
 * for Wikidata, `OuvrirStreetMap` for OpenStreetMap, `Plejaden` for Pleiades,
 * `Aracide` for Arachne and `iDAI.gazetteter` for iDAI.gazetteer, and it
 * dropped half of `Tafeln I–LXIV`. **Domain vocabulary** — this atlas's own
 * site categories and frontier marks — is here because the model reads them as
 * ordinary English words with no archaeology in scope: `Settlement` came back
 * as `Abrechnung` and `Règlement` (both the financial sense), `Legionary
 * fortress` as `Fortaleza legislativa`, and `Watchtower` as `La Tour de
 * Garde`, which is a magazine.
 *
 * A frozen key is **not** forced to English — it keeps whatever the target
 * catalogue already holds, so a considered human translation (`Wikipédia` in
 * French, `Kleinkastell` in German) is permanent rather than something the
 * next run overwrites. English is only the fallback when the key is missing
 * entirely, which is also what makes a new wordmark safe to add here before
 * anyone has translated it.
 *
 * This exists because the resumability rule below cannot tell the two cases
 * apart on its own: it re-translates any key whose value still equals the
 * English source, which is exactly what a correctly-untranslated wordmark
 * looks like. Every run therefore re-mangled the same names.
 *
 * **A new external link scheme or site category belongs in this list** — the
 * grouped prefixes are deliberately narrow so that descriptive labels in the
 * same namespace (`schemes.dare`, "Digital Atlas of the Roman Empire") stay
 * translatable, and the cost of that is having to add the next wordmark by
 * hand.
 */
export const FROZEN_KEYS: readonly string[] = [
  // Wordmarks: the name of a project, database or website.
  'siteExternalLinks.schemes.pleiades',
  'siteExternalLinks.schemes.wikidata',
  'siteExternalLinks.schemes.wikipedia',
  'siteExternalLinks.schemes.vici',
  'siteExternalLinks.schemes.trismegistos',
  'siteExternalLinks.schemes.livius',
  'siteExternalLinks.schemes.arachne',
  'siteExternalLinks.schemes.omnesviae',
  'siteExternalLinks.schemes.osmway',
  'siteExternalLinks.schemes.osmnode',
  'siteExternalLinks.schemes.archis',
  'siteExternalLinks.schemes.idai-gazetteer',
  'siteExternalLinks.schemes.historic-england',
  'siteExternalLinks.schemes.mithraeum',
  'enrichment.sources.wikidata',
  'enrichment.sources.pleiades',
  'limesSectorPage.pleiades',
  'basemapSwitcher.tabulaPeutingeriana',
  'tabulaPeutingeriana.title',
  // "Limes" as the Roman frontier, not the fruit. A general model reads it
  // as the latter every time it stands alone as a short phrase: "Volg de
  // limoenen" (Dutch), "Seguir los limones" (Spanish), "Suivre les chaux"
  // (French, "follow the quicklime"), "Seguire le calce" (Italian, same).
  // German alone survived untouched, because "der Limes" is also the
  // correct German historical term. A full five-locale audit later found
  // the same bug in three more keys that this list had missed entirely —
  // "Le limes" rendered as "Les chaux"/"Los limones"/"Le calce"/"De
  // limoenen" — because they are also short standalone labels ("The
  // limes" as a page title or panel heading) with nothing around them to
  // disambiguate the sense.
  'basemapSwitcher.followLimes',
  'limesPanel.theLimes',
  'limesSectorPage.theLimes',
  'limesIndexPage.title',
  // Plate volumes, named in German by the 1896 edition itself.
  'columns.marcusAurelius.tafeln-i-lxiv',
  'columns.marcusAurelius.tafeln-lxv-cxxviii',
  // A monument, its sculpture, and the numbered plates that record it. A
  // general model reads none of these in an archaeological sense: "Column
  // Reliefs" came back as financial relief ("Kolomaflossingen",
  // "Allégements de colonnes"), and "plate" as a licence plate
  // ("Kennnummer des Kennzeichens", "Nummerplaat") or a dinner plate
  // ("Numero piatto") rather than the printing plate a Cichorius Tafel is.
  'columns.title',
  'columns.menuLabel',
  'columns.trajan.tabLabel',
  'columns.trajan.scene',
  'columns.trajan.viewerLabel',
  'columns.marcusAurelius.tabLabel',
  'columns.marcusAurelius.viewerLabel',
  // "Overlay" as the cartographic term. Translated literally it becomes
  // superimposition ("Überlagerungen"), covers ("Couvertures") or surfaces
  // ("Superficies") — each locale's own mapping-software word is used
  // instead (Calques, Capas, Livelli).
  'basemapSwitcher.groupOverlays',
  'overlaySwitcher.title',
  'overlaySwitcher.menuLabel',
]

/**
 * Whole namespaces where every key is domain vocabulary — the nine site
 * categories, the five frontier marks, and the six language names the
 * enrichment panel labels borrowed prose with (`English` once became
 * `Changements climatiques`).
 */
export const FROZEN_KEY_PREFIXES: readonly string[] = [
  'categories.',
  'limesMarks.',
  'minorFeaturePopup.kind.',
  'enrichment.languages.',
  // Every string in the plate pager names a plate — see the note on
  // `columns.title` above for what a general model does with that word.
  'columns.pager.',
]

export const isFrozenKey = (key: string): boolean =>
  FROZEN_KEYS.includes(key) || FROZEN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))

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
      // A key path comes from this project's own en.json, but walking
      // attacker-shaped segments this way is the textbook prototype-pollution
      // pattern, so the unsafe names are refused outright rather than trusted
      // by provenance alone.
      if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
        throw new Error(`Refusing to unflatten unsafe key segment "${segment}" in "${path}"`)
      }
      if (cursor[segment] === undefined) cursor[segment] = {}
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop
      cursor = cursor[segment] as Record<string, unknown>
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
 * LibreTranslate returns a trimmed string, and the space before a placeholder
 * lives at the end of the segment in front of it — so "Scene {number}" split
 * into "Scene " and "{number}" came back joined as "Szenerie{number}", with
 * the word and the number run together in every locale. The same loss made
 * "of {total}" into "von{total}". Whatever whitespace the source segment
 * ended or began with is put back around the translated text; nothing else
 * about the reply is touched.
 */
export const restoreSurroundingSpace = (source: string, translated: string): string => {
  const leading = source.slice(0, source.length - source.trimStart().length)
  const trailing = source.slice(source.trimEnd().length)
  return `${leading}${translated.trim()}${trailing}`
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
    translated.push(restoreSurroundingSpace(segment.text, result))
  }

  return translated.join('')
}

/**
 * LibreTranslate's gunicorn arbiter has been observed leaving the container
 * with zero live workers after a routine recycle ("Autorestarting worker
 * after current request" with no matching "Booting worker" afterward) — the
 * master keeps listening, so a connection queues forever instead of failing,
 * and no per-key timeout in this script can distinguish that from a slow
 * translation. Checking `/languages` up front, with its own timeout, turns
 * that into one clear failure before spending 15s times however many keys
 * are pending. `docker restart` on the container is the fix; there is no
 * in-script recovery from a dead arbiter.
 */
const PREFLIGHT_TIMEOUT_MS = 5000

const checkTranslateService = async (translateUrl: string): Promise<boolean> => {
  try {
    // NUXT_TRANSLATE_URL already points at the /translate endpoint itself
    // (see .env.example), so /languages is resolved against its origin
    // rather than appended to the path — the naive concatenation hits
    // /translate/languages, a 404 that looks identical to a dead arbiter.
    const languagesUrl = new URL('/languages', translateUrl)
    const response = await Promise.race([
      fetch(languagesUrl),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PREFLIGHT_TIMEOUT_MS)),
    ])
    return response !== null && response.ok
  } catch {
    return false
  }
}

/**
 * A frozen key keeps whatever the target catalogue already holds and falls
 * back to English only when it holds nothing, so a newly added wordmark is
 * filled in without ever being sent to the translator. Mutates `target`.
 */
const fillMissingFrozenKeys = (
  target: Record<string, string>,
  source: Record<string, string>,
): void => {
  for (const [key, text] of Object.entries(source)) {
    if (isFrozenKey(key) && !target[key]) target[key] = text
  }
}

const main = async (): Promise<void> => {
  const translateUrl = process.env.NUXT_TRANSLATE_URL
  if (!translateUrl) {
    console.error('NUXT_TRANSLATE_URL is not set — nothing to translate against.')
    process.exitCode = 1
    return
  }

  if (!(await checkTranslateService(translateUrl))) {
    console.error(
      `${translateUrl}/languages did not respond within ${PREFLIGHT_TIMEOUT_MS}ms. ` +
        'LibreTranslate is likely up but out of workers — restart the container ' +
        '(`docker restart vestigian-dev-libretranslate-1`) and try again.',
    )
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

    fillMissingFrozenKeys(resultFlat, sourceFlat)

    const pending = Object.entries(sourceFlat).filter(
      // Resumable: a key already translated to something other than the
      // English source is left alone rather than re-spent against the model.
      // A frozen key is skipped whatever its value — the resumability rule
      // cannot tell a deliberately-English wordmark from an untranslated one.
      ([key, text]) => !isFrozenKey(key) && !(resultFlat[key] && resultFlat[key] !== text),
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
