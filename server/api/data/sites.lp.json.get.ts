import { buildLinkedPlaceFeature, buildLinkedPlacesCollection } from '#shared/utils/linkedPlaces'
import { fetchSiteFeedRows, siteFeedQuerySchema } from '~~/server/utils/site-feed'

export const querySchema = siteFeedQuerySchema

/**
 * The same atlas as `/api/data/sites.geojson`, in the format the Pelagios
 * Network reads.
 *
 * This project consumes vici.org, EDH, AWMC, OpenHistoricalMap, CHRR and ORBIS
 * and until now published back only a plain GeoJSON feed — usable as data, but
 * invisible as a *gazetteer*. Linked Places Format is what Recogito, Peripleo
 * and the World Historical Gazetteer actually reconcile against, so emitting it
 * is what puts Vestigian inside that graph rather than beside it. The
 * `closeMatch` links to Pleiades and Wikidata are the part that does the work:
 * they let an aggregator recognise that a record here and a record there are
 * the same place.
 *
 * Bounded and paged like its GeoJSON sibling — a reuse feed, not a way to pull
 * the whole database in one request — and CORS-open for the same reason.
 */
defineRouteMeta({
  openAPI: {
    tags: ['data'],
    summary: 'Linked Places Format feed of approved sites',
    description:
      'Read-only, bounded and paged Pelagios-compatible gazetteer feed (LPF v1.3). CORS-open. Also valid GeoJSON. Text is CC BY-SA / metadata CC0; image licences vary per record and are not part of this feed. Pass ?dated=true for only the records carrying a period, which is the strictly v1.3-conformant subset.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const query = await getValidatedQuery(event, querySchema.parse)
  const rows = await fetchSiteFeedRows(useSql(), query)

  setResponseHeaders(event, {
    // LPF is GeoJSON-LD; the JSON-LD type is what a gazetteer content-negotiates on.
    'content-type': 'application/ld+json',
    // `private`: the pull zone ignores the query string (see sites.geojson.get.ts).
    'cache-control': 'private, max-age=300',
    'access-control-allow-origin': '*',
  })

  const siteUrl = useRuntimeConfig().public.siteUrl

  return buildLinkedPlacesCollection(
    rows.map((row) =>
      buildLinkedPlaceFeature({
        id: `${siteUrl}/site/${row.slug}`,
        title: row.title,
        category: row.category,
        longitude: row.lon,
        latitude: row.lat,
        countryCode: row.country_code,
        summary: row.summary,
        periodFrom: row.period_from,
        periodTo: row.period_to,
        licence: row.licence,
        attribution: row.attribution,
        identifiers: row.identifiers,
      }),
    ),
  )
})
