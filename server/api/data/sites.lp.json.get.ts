import { z } from 'zod'
import { siteCategoryEnum } from '~~/server/database/schema'
import {
  buildLinkedPlaceFeature,
  buildLinkedPlacesCollection,
  type LinkedPlaceIdentifier,
} from '#shared/utils/linkedPlaces'
import type { SiteCategory } from '#shared/types'

export const querySchema = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/, 'bbox must be west,south,east,north')
    .optional(),
  // An unknown category used to reach the `::site_category` cast and answer 500.
  category: z.enum(siteCategoryEnum.enumValues).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  /** Rows skipped, in `id` order — see the same field on `sites.geojson.get.ts`. */
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
  /**
   * Only records this atlas actually dates. LPF requires a `when` on every
   * Feature and roughly half of these sites carry no dating at all, so a
   * consumer needing strict v1.3 conformance asks for the dated subset rather
   * than receiving invented dates — see `shared/utils/linkedPlaces.ts`.
   */
  dated: z.coerce.boolean().optional(),
})

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
  const { bbox, category, limit, offset, dated } = await getValidatedQuery(event, querySchema.parse)
  const sql = useSql()

  const [west, south, east, north] = bbox ? bbox.split(',').map(Number) : [-180, -85, 180, 85]

  /**
   * The identifiers are aggregated in the same query rather than fetched per
   * site: at up to 1000 records a request, a second round trip each would be
   * 1000 queries to build one response. `FILTER` keeps sites with no
   * concordances in the result with an empty array rather than dropping them.
   */
  const rows = await sql<
    {
      slug: string
      title: string
      category: SiteCategory
      period_from: number | null
      period_to: number | null
      country_code: string | null
      summary: string | null
      licence: string
      attribution: string | null
      lon: number
      lat: number
      identifiers: { scheme: string; value: string }[] | null
    }[]
  >`
    SELECT s.slug, s.title, s.category::text AS category,
           s.period_from, s.period_to, s.country_code, s.summary,
           s.licence, s.attribution,
           ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
           COALESCE(
             jsonb_agg(jsonb_build_object('scheme', e.scheme, 'value', e.value))
               FILTER (WHERE e.id IS NOT NULL),
             '[]'::jsonb
           ) AS identifiers
    FROM sites s
    LEFT JOIN external_ids e ON e.site_id = s.id
    WHERE s.status = 'approved'
      AND s.geom && ST_MakeEnvelope(${west!}, ${south!}, ${east!}, ${north!}, 4326)
      ${category ? sql`AND s.category = ${category}::site_category` : sql``}
      ${dated ? sql`AND (s.period_from IS NOT NULL OR s.period_to IS NOT NULL)` : sql``}
    GROUP BY s.id
    ORDER BY s.id
    LIMIT ${limit} OFFSET ${offset}
  `

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
        identifiers: (row.identifiers ?? []).reduce<LinkedPlaceIdentifier[]>(
          (links, identifier) => {
            // A scheme with no safe URL pattern is dropped rather than linked to a
            // guessed address — see `EXTERNAL_URL_PATTERNS`' own note on the four
            // deliberately unlinked ones.
            const url = buildExternalUrl(identifier.scheme, identifier.value)
            if (url) links.push({ scheme: identifier.scheme, url })
            return links
          },
          [],
        ),
      }),
    ),
  )
})
