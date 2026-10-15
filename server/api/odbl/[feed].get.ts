import { z } from 'zod'
import { licenceUri } from '#shared/utils/licence-uris'
import { ODBL_FEED_META, parseOdblFeedName } from '#shared/utils/odbl-feeds'
import {
  buildOdblDataset,
  buildOdblGeoJson,
  fetchOdblFeedPage,
  odblFeedQuerySchema,
  resolveOdblFeedQuery,
} from '~~/server/utils/odbl-feeds'
import { serialiseTurtle } from '~~/server/utils/rdf'

export const paramsSchema = z.object({
  /** `awmc-lines.geojson`, `limes.ttl` — the layer and its format, as one path segment. */
  feed: z.string().min(1).max(60),
})

export const querySchema = odblFeedQuerySchema

/**
 * The reference layers this atlas holds under the Open Database Licence,
 * offered back as ODbL §4.6 asks: the entire derivative database, in a
 * machine-readable form, to anyone who receives its produced works (the tiles).
 *
 * **Apart from `/api/data/`, on purpose.** That path is the CC BY-SA / CC0 feed
 * and promises nothing from the reference layers; these rows are share-alike and
 * several come through more than one upstream, so each feed says what it is made
 * of, under which licences, and what was altered.
 *
 * One handler for all layers because they differ only in table and columns; the
 * list of what exists is `shared/utils/odbl-feeds.ts`, which `/licence` reads
 * too. GeoJSON for maps and analysis, Turtle (`.ttl`) for a triple store.
 */
defineRouteMeta({
  openAPI: {
    tags: ['data'],
    summary: 'ODbL reference-layer feeds (GeoJSON or Turtle)',
    description:
      'Read-only, bounded and paged. CORS-open. Share-alike: ODbL 1.0 over AWMC, OpenStreetMap and the Ancient Sites and Monuments Survey, and ODbL 1.0 with CC BY-NC 3.0 for the coin hoards. The path segment is a layer and a format, such as awmc-lines.geojson or limes.ttl; each feature names its source and licence where they differ from the collection’s.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const { feed } = await getValidatedRouterParams(event, paramsSchema.parse)
  const parsed = parseOdblFeedName(feed)
  if (!parsed) throw createError({ statusCode: 404, message: 'No such feed.' })

  const query = resolveOdblFeedQuery(
    parsed.layer,
    await getValidatedQuery(event, querySchema.parse),
  )
  const page = await fetchOdblFeedPage({
    sql: useSql(),
    layer: parsed.layer,
    query,
    format: parsed.format,
  })

  setResponseHeaders(event, {
    // `private`: the pull zone ignores the query string, as for the site feeds.
    'cache-control': 'private, max-age=300',
    'access-control-allow-origin': '*',
    // The collection's own licence rides in the headers too, for a consumer that
    // only ever sees the response and not the page that linked to it.
    link: ODBL_FEED_META[parsed.layer].licences
      .map((code) => licenceUri(code))
      .filter((url): url is string => url !== null)
      .map((url) => `<${url}>; rel="license"`)
      .join(', '),
  })

  if (parsed.format === 'ttl') {
    setResponseHeader(event, 'content-type', 'text/turtle; charset=utf-8')
    return serialiseTurtle(buildOdblDataset(page, useRuntimeConfig().public.siteUrl))
  }

  setResponseHeader(event, 'content-type', 'application/geo+json')
  return buildOdblGeoJson(page)
})
