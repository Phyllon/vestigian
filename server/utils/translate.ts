import { Translate } from 'translate'

/**
 * Machine translation for borrowed article text, through a LibreTranslate we
 * run ourselves.
 *
 * Self-hosted for the same reason the fonts are: reading a site should not
 * send anything about it to a third party. It also means no API key, no
 * per-character bill, and no new origin in a CSP that has been kept to five
 * hosts — the browser never talks to it, only the server does.
 *
 * **Everything here fails open.** Translation is an improvement on the reading
 * experience, never a precondition for it. If the service is down, still
 * loading its models, or simply slow, the caller keeps the original text and
 * the panel labels it with the language it is actually in. That is a worse
 * experience than a translation and a far better one than an empty panel.
 */

/** Long enough for a cold model, short enough not to hold a request open. */
const TRANSLATE_TIMEOUT_MS = 10000

/**
 * LibreTranslate charges nothing per call but is not free to run — a cold
 * model can take seconds. Anything longer than a lead paragraph is not worth
 * the wait, and Wikipedia summaries sit well under this.
 */
const MAX_TRANSLATABLE_CHARACTERS = 1500

export interface TranslationRequest {
  text: string
  /** ISO code the text is in. */
  from: string
  to: string
}

/**
 * Returns the translated text, or null when translation was not possible.
 *
 * Null is not an error condition to report — it is the ordinary answer when
 * the service is unavailable or the text is not worth sending.
 */
export const translateText = async (request: TranslationRequest): Promise<string | null> => {
  const { translate } = useRuntimeConfig()

  if (!translate.url) return null
  if (request.from === request.to) return null
  if (!request.text || request.text.length > MAX_TRANSLATABLE_CHARACTERS) return null

  try {
    /**
     * `url` is a documented option of the libre engine — it is what makes a
     * self-hosted instance usable — but the package's type declaration omits
     * it, hence the cast. Without it the call would go to libretranslate.com,
     * which is precisely the third party this service exists to avoid.
     */
    const translator = Translate({
      engine: 'libre',
      url: translate.url,
      from: request.from,
      to: request.to,
    } as Parameters<typeof Translate>[0])

    const translated = await Promise.race([
      translator(request.text),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TRANSLATE_TIMEOUT_MS)),
    ])

    if (typeof translated !== 'string' || translated.trim().length === 0) return null

    // A model that has nothing to offer sometimes echoes the input back.
    // Presenting that as a translation would be a lie about what happened.
    return translated.trim() === request.text.trim() ? null : translated
  } catch {
    return null
  }
}
