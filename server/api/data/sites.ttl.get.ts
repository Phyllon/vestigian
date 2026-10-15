import { featureClassesFor, linkRelationFor } from '#shared/utils/linkedPlaces'
import { fetchSiteFeedRows, siteFeedQuerySchema } from '~~/server/utils/site-feed'
import { serialiseTurtle, type RdfFeature } from '~~/server/utils/rdf'

export const querySchema = siteFeedQuerySchema

/**
 * The same records as `/api/data/sites.lp.json`, as RDF in Turtle.
 *
 * Linked Places Format is JSON-LD in an LPF-specific shape; this is the plain
 * graph, for a triple store or a SPARQL endpoint to load. Same parameters, same
 * order, same page boundaries as the LPF feed, because a reconciler walking one
 * expects the other to agree.
 *
 * **Licence.** The structured metadata (coordinates, dates, categories) is CC0
 * and each description carries the record's own licence (`dcterms:license`,
 * CC BY-SA 3.0 for everything imported from vici.org). Nothing from the
 * reference layers is in here — those are ODbL or other third-party terms and
 * have their own feeds under `/api/odbl/`.
 */
defineRouteMeta({
  openAPI: {
    tags: ['data'],
    summary: 'RDF (Turtle) feed of approved sites',
    description:
      'Read-only, bounded and paged. CORS-open. GeoSPARQL geometry, skos:closeMatch links to Pleiades and Wikidata. Text is CC BY-SA / metadata CC0; image licences vary per record and are not part of this feed.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const query = await getValidatedQuery(event, querySchema.parse)
  const rows = await fetchSiteFeedRows(useSql(), query)
  const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

  setResponseHeaders(event, {
    'content-type': 'text/turtle; charset=utf-8',
    // `private`: the pull zone ignores the query string (see sites.geojson.get.ts).
    'cache-control': 'private, max-age=300',
    'access-control-allow-origin': '*',
  })

  return serialiseTurtle({
    iri: `${siteUrl}/api/data/sites.ttl`,
    title: 'Vestigian: approved sites',
    credit: `Vestigian (${siteUrl}), built on the openly licensed records of vici.org and its contributors. Sources and licences: ${siteUrl}/licence`,
    licences: ['CC0-1.0'],
    rights: 'Descriptions are CC BY-SA, as stated on each record; structured metadata is CC0 1.0.',
    alterations: null,
    features: rows.map((row): RdfFeature => ({
      iri: `${siteUrl}/site/${row.slug}`,
      label: row.title,
      kind: row.category,
      description: row.summary,
      featureClass: featureClassesFor(row.category)[0] ?? null,
      period: { from: row.period_from, to: row.period_to },
      wkt: `POINT(${row.lon} ${row.lat})`,
      licence: row.licence,
      attribution: row.attribution,
      source: null,
      links: row.identifiers.map((identifier) => ({
        relation: linkRelationFor(identifier.scheme),
        url: identifier.url,
      })),
      extra: { countryCode: row.country_code },
    })),
  })
})
