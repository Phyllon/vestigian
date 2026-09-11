import { z } from 'zod'
import { ENRICHMENT_LANGUAGES } from '#shared/types'
import type { EnrichmentLanguage, InscriptionDetail } from '#shared/types'

export const paramsSchema = z.object({ edhId: z.string().regex(/^HD\d+$/) })

export const querySchema = z.object({
  /** The reader's chosen UI language. Omitted or equal to `de` returns the
   *  metadata exactly as EDH wrote it. */
  lang: z.enum(ENRICHMENT_LANGUAGES).optional(),
})

/**
 * EDH's own scholarly metadata — `title`, `commentary` — is authored in
 * German throughout the mirrored corpus (verified live across the sample in
 * `.claude/rules/epigraphy.md`), unlike `textLanguage`, which names the
 * *inscription's own* carved language (Latin or Greek). Only these two prose
 * fields are ever translated; the transcription itself is a primary source,
 * not something a machine should be putting words into.
 */
const METADATA_SOURCE_LANGUAGE: EnrichmentLanguage = 'de'

/** Matches `enrichment.get.ts`'s own cache lifetimes for the same reasoning:
 *  a week for an answer, a day for "nothing came back". */
const TRANSLATION_HIT_TTL_SECONDS = 604800
const TRANSLATION_MISS_TTL_SECONDS = 86400

const translationCacheKeyFor = (edhId: string, lang: EnrichmentLanguage): string =>
  `inscription-translate:v1:${edhId}:${lang}`

interface MetadataTranslation {
  title: string | null
  commentary: string | null
}

defineRouteMeta({
  openAPI: {
    tags: ['inscriptions'],
    summary: 'Get one mirrored EDH inscription by its EDH id',
    description:
      "`lang` machine-translates the title and commentary from EDH's own German into one of the six interface languages, through the same self-hosted LibreTranslate `/api/sites/:id/enrichment` uses. The carved transcription itself is never translated.",
  },
})

export default defineEventHandler(async (event): Promise<InscriptionDetail> => {
  await enforceRateLimit(event, 'record')
  const { edhId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { lang } = await getValidatedQuery(event, querySchema.parse)

  const inscription = await loadInscriptionDetail(edhId)
  if (!inscription) {
    throw createError({ statusCode: 404, message: 'No mirrored inscription with that identifier.' })
  }

  const targetLanguage = lang ?? METADATA_SOURCE_LANGUAGE
  if (targetLanguage === METADATA_SOURCE_LANGUAGE) {
    return {
      ...inscription,
      language: METADATA_SOURCE_LANGUAGE,
      originalLanguage: METADATA_SOURCE_LANGUAGE,
      isMachineTranslated: false,
    }
  }

  const translated = await translateInscriptionMetadata(inscription, targetLanguage)

  return {
    ...inscription,
    title: translated.title ?? inscription.title,
    commentary: translated.commentary ?? inscription.commentary,
    language: translated.title || translated.commentary ? targetLanguage : METADATA_SOURCE_LANGUAGE,
    originalLanguage: METADATA_SOURCE_LANGUAGE,
    isMachineTranslated: Boolean(translated.title || translated.commentary),
  }
})

/**
 * Cached per (inscription, language) so a visitor never waits on
 * LibreTranslate twice for the same pair — the same reasoning
 * `enrichment.get.ts` caches a whole translated extract, scoped down here to
 * just the two fields worth sending.
 */
const translateInscriptionMetadata = async (
  inscription: Pick<InscriptionDetail, 'edhId' | 'title' | 'commentary'>,
  targetLanguage: EnrichmentLanguage,
): Promise<MetadataTranslation> => {
  const cacheKey = translationCacheKeyFor(inscription.edhId, targetLanguage)

  try {
    const cached = await useRedis().get(cacheKey)
    if (cached !== null) return JSON.parse(cached) as MetadataTranslation
  } catch {
    // Cache outage: fall through and translate fresh.
  }

  const [title, commentary] = await Promise.all([
    translateText({
      text: inscription.title,
      from: METADATA_SOURCE_LANGUAGE,
      to: targetLanguage,
    }),
    inscription.commentary
      ? translateText({
          text: inscription.commentary,
          from: METADATA_SOURCE_LANGUAGE,
          to: targetLanguage,
        })
      : Promise.resolve(null),
  ])

  const result: MetadataTranslation = { title, commentary }

  try {
    await useRedis().set(
      cacheKey,
      JSON.stringify(result),
      'EX',
      title || commentary ? TRANSLATION_HIT_TTL_SECONDS : TRANSLATION_MISS_TTL_SECONDS,
    )
  } catch {
    // Non-fatal.
  }

  return result
}
