import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ENRICHMENT_LANGUAGES } from '#shared/types'
import type { EnrichmentLanguage, SiteEnrichment } from '#shared/types'

export const paramsSchema = z.object({ id: routeIdentifier })

export const querySchema = z.object({
  /** The reader's chosen UI language. Falls back to the server default (translate.target) when omitted. */
  lang: z.enum(ENRICHMENT_LANGUAGES).optional(),
})

/** A week for an answer, a day for a refusal. */
const HIT_TTL_SECONDS = 604800
const MISS_TTL_SECONDS = 86400

/**
 * Language-scoped: without it, whichever visitor happened to warm the cache
 * first would silently serve their translation to every other language's
 * request for the same site.
 */
const cacheKeyFor = (siteId: number, lang: EnrichmentLanguage): string =>
  `enrich:v3:${siteId}:${lang}`

/**
 * Borrowed prose about one site, or null.
 *
 * Null is the ordinary answer. Only about 5% of the atlas can be matched to an
 * outside record with any certainty — 3,489 sites carry a Wikidata id, another
 * 1,168 are reachable through their Pleiades or DARE concordances, and a
 * quarter of those are then refused because the two records disagree about
 * where the place is or what it is. Every other site simply gets nothing, which
 * is the honest result and not an error.
 *
 * This runs on the server rather than in the browser for three reasons, in
 * order of weight: the CSP allows no Wikimedia origin and widening it is not
 * worth a nice-to-have; one fetch here serves every visitor, where a browser
 * fetch would have each of them asking Wikimedia separately; and visitors' IPs
 * never reach a third party. Wikidata's search endpoint throttles after eight
 * calls spaced 800ms apart, so the shared cache is not an optimisation — it is
 * what makes the feature viable at all.
 */
defineRouteMeta({
  openAPI: {
    tags: ['sites'],
    summary: 'Get a borrowed Wikipedia extract for a site',
    description:
      'Null is an ordinary answer — most sites have no confident external match. Server-proxied and cached; never fetched from the browser. `lang` picks the target language, defaulting to the server configuration when omitted.',
  },
})

export default defineEventHandler(async (event): Promise<SiteEnrichment | null> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { lang } = await getValidatedQuery(event, querySchema.parse)
  await enforceRateLimit(event, 'enrichment')

  const { translate } = useRuntimeConfig()
  const targetLanguage = lang ?? (translate.target as EnrichmentLanguage) ?? 'en'

  const cacheKey = cacheKeyFor(id, targetLanguage)

  try {
    const cached = await useRedis().get(cacheKey)
    // An empty string is a cached refusal — distinct from a cache miss, so a
    // site with no match is not re-asked upstream on every open.
    if (cached !== null) return cached === '' ? null : (JSON.parse(cached) as SiteEnrichment)
  } catch {
    // Cache outage: fall through and answer from upstream.
  }

  const database = useDatabase()

  /**
   * Drizzle, with `ST_X`/`ST_Y` as raw expressions.
   *
   * The geometry accessors have no query-builder equivalent, but that is no
   * reason to hand-write the whole statement. This way the table, the column
   * names and the `status` literal are all checked against `database/schema`,
   * and only the two PostGIS calls are not — where the raw version was one
   * long `sql<...>` assertion the compiler took entirely on trust. `category`
   * arrives typed as the enum rather than as a `string` claimed to be one.
   */
  const [site] = await database
    .select({
      category: schema.sites.category,
      lon: sql<number>`ST_X(${schema.sites.geom})`,
      lat: sql<number>`ST_Y(${schema.sites.geom})`,
    })
    .from(schema.sites)
    .where(and(eq(schema.sites.id, id), eq(schema.sites.status, 'approved')))
    .limit(1)

  if (!site)
    throw createError({ statusCode: 404, message: 'No approved site with that identifier.' })

  const identifiers = await database
    .select({ scheme: schema.externalIds.scheme, value: schema.externalIds.value })
    .from(schema.externalIds)
    .where(
      and(
        eq(schema.externalIds.siteId, id),
        inArray(schema.externalIds.scheme, ['wikidata', 'pleiades', 'dare']),
      ),
    )

  const first = (scheme: string): string | null =>
    identifiers.find((row) => row.scheme === scheme)?.value ?? null

  const pleiadesId = first('pleiades')

  const enrichment = await buildEnrichment({
    site: { position: { lon: site.lon, lat: site.lat }, category: site.category },
    identifiers: {
      wikidataId: normaliseWikidataId(first('wikidata')),
      pleiadesId,
      dareId: first('dare'),
    },
    targetLanguage,
  })

  try {
    await useRedis().set(
      cacheKey,
      enrichment ? JSON.stringify(enrichment) : '',
      'EX',
      enrichment ? HIT_TTL_SECONDS : MISS_TTL_SECONDS,
    )
  } catch {
    // Non-fatal.
  }

  return enrichment
})

interface BuildRequest {
  site: { position: { lon: number; lat: number }; category: SiteCategory }
  identifiers: { wikidataId: string | null; pleiadesId: string | null; dareId: string | null }
  targetLanguage: EnrichmentLanguage
}

/**
 * Resolve, verify, then fetch the prose — in that order, so nothing is
 * retrieved for a candidate that is about to be refused.
 */
const buildEnrichment = async (request: BuildRequest): Promise<SiteEnrichment | null> => {
  const { site, identifiers, targetLanguage } = request

  // No concordance means no lead worth following. Searching by name and
  // position was measured and produces modern towns and railway stations, so
  // there is nothing to try here.
  if (!identifiers.wikidataId && !identifiers.pleiadesId && !identifiers.dareId) return null

  const resolved = await resolveWikidataEntity(identifiers)
  if (!resolved) return null

  const facts = await loadWikidataFacts(resolved.id, targetLanguage)

  const placeTypes = identifiers.pleiadesId
    ? await loadPleiadesPlaceTypes(identifiers.pleiadesId)
    : facts.placeTypes

  const verdict = verifyEnrichmentMatch({
    site,
    candidate: { position: facts.position, placeTypes },
  })

  if (!verdict.accepted || !facts.article) return null

  const summary = await loadWikipediaSummary(facts.article)
  if (!summary) return null

  /**
   * Translated here rather than in the browser so it happens once per
   * (site, language) pair and lands in the same cache entry as the extract. A
   * visitor never waits on LibreTranslate twice for the same site in the same
   * language, and never waits at all on a warm key. `loadWikidataFacts` above
   * already preferred a native article in `targetLanguage` when one exists, so
   * this only fires when nothing but a foreign-language article was found.
   */
  const translated =
    summary.language === targetLanguage
      ? null
      : await translateText({ text: summary.extract, from: summary.language, to: targetLanguage })

  return {
    title: summary.title,
    extract: translated ?? summary.extract,
    articleUrl: summary.articleUrl,
    language: translated ? targetLanguage : summary.language,
    originalLanguage: summary.language,
    isMachineTranslated: translated !== null,
    source: 'Wikipedia',
    licence: 'CC BY-SA 4.0',
    matchedVia: resolved.matchedVia,
    matchedWithinMetres: Math.round(verdict.distanceMetres ?? 0),
  }
}
