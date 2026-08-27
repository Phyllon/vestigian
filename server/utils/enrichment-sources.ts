import type { EnrichmentRoute, LonLat } from '#shared/types'

/**
 * Talking to the ancient-world gazetteers. The judgement about what comes back
 * lives in `enrichment.ts`; this file only fetches.
 *
 * Three services, each doing the one thing it is best at:
 *
 * - **Wikidata** is the hub. It holds the coordinate we verify against, and it
 *   is reachable from the other gazetteers' identifiers, which is what lets a
 *   site with only a Pleiades id find its way to an article.
 * - **Pleiades** is the gazetteer of the ancient world. Its descriptions are
 *   usually stubs — "An ancient place, cited: BAtlas 11 D1 Aardenburg" — so it
 *   is read for `placeTypes`, not for prose.
 * - **Wikipedia** supplies the prose, through the REST summary endpoint:
 *   2.4 KB against 19 KB for a full Wikidata entity dump.
 *
 * Every call identifies itself. Wikimedia's API etiquette asks for a
 * descriptive User-Agent and throttles clients that do not send one — and it
 * throttles hard regardless: eight search calls spaced 800 ms apart were
 * answered with "You are making too many requests to the API." That is why
 * this is a server-side proxy behind a Valkey cache and not a browser fetch.
 */
const USER_AGENT = 'Vestigia/0.1 (https://vestigia.example; atlas of the ancient world)'

const REQUEST_TIMEOUT_MS = 8000

/** Wikidata properties used as join keys, confirmed against the live API. */
const PLEIADES_PROPERTY = 'P1584'
const DARE_PROPERTY = 'P1936'

/**
 * Wikipedias consulted, in order of preference.
 *
 * English first because the interface is English. The rest are the languages
 * this atlas is actually written over — Dutch, German, Spanish and Italian
 * ground — and they are the difference between an article and nothing. Across
 * 60 randomly sampled sites carrying a Wikidata id, English alone reached 77%;
 * all five reach 87%. The fallback is not hypothetical but it is not the
 * common case either: of 52 matches, English served 46, German 4, Dutch 1 and
 * Spanish 1.
 *
 * The order is a preference, not a ranking of quality — the first language
 * with an article wins, and the reader is told which one they are reading.
 */
const ARTICLE_LANGUAGES = ['en', 'nl', 'de', 'es', 'it', 'fr'] as const

export type ArticleLanguage = (typeof ARTICLE_LANGUAGES)[number]

export interface ArticleReference {
  language: ArticleLanguage
  title: string
}

/**
 * `source` is a fixed vocabulary — `wikidata`, `pleiades`, `wikipedia` — so it
 * is safe as a metric label. The URL never is.
 */
const request = async <T>(url: string, source: string): Promise<T | null> => {
  try {
    // Native `fetch`, not `$fetch`: ofetch's typing is built around Nitro's own
    // routes and tries to match a string URL against every one of them, which
    // for a third-party address is both meaningless and a combinatorial
    // explosion the compiler gives up on.
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      // A non-2xx returns here without ever entering the catch below, which is
      // why it needs its own line: Wikidata answering 429 to everything looks
      // exactly like "no article exists for this site" from the caller's side,
      // and the two want opposite responses from whoever is reading.
      enrichmentRequestsTotal().inc({ source, outcome: 'refused' })
      useLogger().warn({ source, status: response.status }, 'enrichment upstream refused')
      return null
    }

    enrichmentRequestsTotal().inc({ source, outcome: 'ok' })
    return (await response.json()) as T
  } catch (error) {
    // An upstream that is slow, throttling or down means no enrichment for
    // this site right now. It never means the site fails to open.
    const timedOut = (error as Error).name === 'TimeoutError'
    enrichmentRequestsTotal().inc({ source, outcome: timedOut ? 'timeout' : 'failed' })
    useLogger().warn(
      { source, err: { message: (error as Error).message } },
      'enrichment upstream unreachable',
    )
    return null
  }
}

/**
 * Finds the single Wikidata entity carrying a given gazetteer identifier.
 *
 * **Exactly one hit, or nothing.** A Pleiades id is not reliably unique on
 * Wikidata — `P1584=89143` (Cataractonium) returns three entities — and there
 * is no basis for preferring one, so more than one candidate is an answer of
 * "we cannot be sure", which is the whole premise here.
 */
const findByStatement = async (property: string, value: string): Promise<string | null> => {
  const query = encodeURIComponent(`haswbstatement:${property}=${value}`)
  const data = await request<{ query?: { search?: { title: string }[] } }>(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&origin=*`,
    'wikidata',
  )

  const hits = data?.query?.search ?? []
  return hits.length === 1 ? (hits[0]!.title ?? null) : null
}

interface WikidataEntity {
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>
  sitelinks?: Record<string, { title?: string }>
}

const readCoordinate = (entity: WikidataEntity): LonLat | null => {
  const value = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value as
    { latitude?: number; longitude?: number } | undefined

  if (typeof value?.latitude !== 'number' || typeof value?.longitude !== 'number') return null
  return { lon: value.longitude, lat: value.latitude }
}

/**
 * Resolves a site's concordances to one Wikidata entity, trying the routes in
 * descending order of directness and stopping at the first that answers.
 *
 * The ladder is what widens coverage past the sites vici happened to give a
 * Wikidata id: 3,489 have one, and the Pleiades and DARE joins reach a further
 * 1,168. DARE is tried last because it resolves least often — two of five
 * sampled — not because it is less trustworthy when it does.
 */
export interface ResolveRequest {
  wikidataId: string | null
  pleiadesId: string | null
  dareId: string | null
}

export const resolveWikidataEntity = async (
  input: ResolveRequest,
): Promise<{ id: string; matchedVia: EnrichmentRoute } | null> => {
  if (input.wikidataId) return { id: input.wikidataId, matchedVia: 'wikidata' }

  if (input.pleiadesId) {
    const found = await findByStatement(PLEIADES_PROPERTY, input.pleiadesId)
    if (found) return { id: found, matchedVia: 'pleiades' }
  }

  if (input.dareId) {
    const found = await findByStatement(DARE_PROPERTY, input.dareId)
    if (found) return { id: found, matchedVia: 'dare' }
  }

  return null
}

/** Coordinate, place types and the best available article, in one call. */
export const loadWikidataFacts = async (
  wikidataId: string,
): Promise<{ position: LonLat | null; placeTypes: string[]; article: ArticleReference | null }> => {
  const sitefilter = ARTICLE_LANGUAGES.map((language) => `${language}wiki`).join('|')

  const data = await request<{ entities?: Record<string, WikidataEntity> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}` +
      `&props=claims%7Csitelinks&sitefilter=${encodeURIComponent(sitefilter)}&format=json&origin=*`,
    'wikidata',
  )

  const entity = data?.entities?.[wikidataId]
  if (!entity) return { position: null, placeTypes: [], article: null }

  let article: ArticleReference | null = null
  for (const language of ARTICLE_LANGUAGES) {
    const title = entity.sitelinks?.[`${language}wiki`]?.title
    if (title) {
      article = { language, title }
      break
    }
  }

  return {
    position: readCoordinate(entity),
    // P31 gives entity ids, not labels, and resolving each to a word costs
    // another round trip for a signal Pleiades states in plain language. The
    // type check leans on Pleiades and treats its absence as "unknown".
    placeTypes: [],
    article,
  }
}

/** Pleiades, read only for `placeTypes` — the signal a coordinate cannot give. */
export const loadPleiadesPlaceTypes = async (pleiadesId: string): Promise<string[]> => {
  const data = await request<{ placeTypes?: string[] }>(
    `https://pleiades.stoa.org/places/${pleiadesId}/json`,
    'pleiades',
  )
  return data?.placeTypes ?? []
}

export interface WikipediaSummary {
  title: string
  extract: string
  articleUrl: string
  language: ArticleLanguage
}

export const loadWikipediaSummary = async (
  article: ArticleReference,
): Promise<WikipediaSummary | null> => {
  const host = `https://${article.language}.wikipedia.org`

  const data = await request<{
    title?: string
    extract?: string
    type?: string
    content_urls?: { desktop?: { page?: string } }
  }>(`${host}/api/rest_v1/page/summary/${encodeURIComponent(article.title)}`, 'wikipedia')

  // Disambiguation pages resolve and read as prose but describe nothing.
  if (!data?.extract || !data.title || data.type === 'disambiguation') return null

  return {
    title: data.title,
    extract: data.extract,
    articleUrl:
      data.content_urls?.desktop?.page ?? `${host}/wiki/${encodeURIComponent(data.title)}`,
    language: article.language,
  }
}
