import { z } from 'zod'
import { SURVEY_SITE_KINDS, SURVEY_SITE_SOURCES } from '#shared/utils/survey-sites'
import {
  buildSurveySiteFeatureCollection,
  type SurveySiteFeedRow,
} from '~~/server/utils/survey-sites-feed'

export const querySchema = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/, 'bbox must be west,south,east,north')
    .optional(),
  kind: z.enum(SURVEY_SITE_KINDS).optional(),
  source: z.enum(SURVEY_SITE_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  /** Rows skipped, in the Survey's own id order — advance by `limit` until a page comes back short. */
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
})

/**
 * The dated survey sites as GeoJSON, **apart from `/api/data/sites.geojson`**: that feed promises
 * CC BY-SA / CC0 and says it carries no imported reference data (`licence.reuseNotIncluded`).
 * These rows come through an ODbL 1.0 compilation from sources under CC BY 4.0 and OGL, so they
 * have a feed of their own that says so, collection-wide and per feature.
 */
defineRouteMeta({
  openAPI: {
    tags: ['data'],
    summary: 'GeoJSON feed of dated survey sites',
    description:
      'Read-only, bounded and paged. CORS-open. ODbL 1.0 (share-alike) over the Ancient Sites and Monuments Survey; every feature names its upstream source and that source licence (CC BY 4.0, OGL). Not part of the CC BY-SA / CC0 site feeds.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const { bbox, kind, source, limit, offset } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const [west, south, east, north] = bbox ? bbox.split(',').map(Number) : [-180, -85, 180, 85]

  const rows = await sql<SurveySiteFeedRow[]>`
    SELECT survey_id, name, source, kind, period_keys, period_from, period_to, period_basis,
           destroyed, uncertain, evidence, ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM antiquity_survey_sites
    WHERE geom && ST_MakeEnvelope(${west!}, ${south!}, ${east!}, ${north!}, 4326)
      ${kind ? sql`AND kind = ${kind}` : sql``}
      ${source ? sql`AND source = ${source}` : sql``}
    ORDER BY survey_id
    LIMIT ${limit} OFFSET ${offset}
  `

  setResponseHeaders(event, {
    'content-type': 'application/geo+json',
    // `private`: the pull zone ignores the query string, as for the site feeds.
    'cache-control': 'private, max-age=300',
    'access-control-allow-origin': '*',
  })

  return buildSurveySiteFeatureCollection(rows)
})
