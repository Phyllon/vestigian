import { z } from 'zod'
import type postgres from 'postgres'
import { siteCategoryEnum } from '~~/server/database/schema'
import type { SiteCategory } from '#shared/types'
import type { LinkedPlaceIdentifier } from '#shared/utils/linkedPlaces'
import { buildExternalUrl } from './site-record'

/**
 * The parameters shared by the two feeds that carry the gazetteer view of the
 * atlas — `sites.lp.json` (Linked Places Format) and `sites.ttl` (RDF). Written
 * once so the two cannot drift: a reconciler that pages one and then the other
 * expects the same records on the same page.
 */
export const siteFeedQuerySchema = z.object({
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

export type SiteFeedQuery = z.infer<typeof siteFeedQuerySchema>

export interface SiteFeedRow {
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
  identifiers: LinkedPlaceIdentifier[]
}

/**
 * The identifiers are aggregated in the same query rather than fetched per
 * site: at up to 1000 records a request, a second round trip each would be
 * 1000 queries to build one response. `FILTER` keeps sites with no
 * concordances in the result with an empty array rather than dropping them.
 */
export const fetchSiteFeedRows = async (
  sql: postgres.Sql,
  query: SiteFeedQuery,
): Promise<SiteFeedRow[]> => {
  const { bbox, category, limit, offset, dated } = query
  const [west, south, east, north] = bbox ? bbox.split(',').map(Number) : [-180, -85, 180, 85]

  const rows = await sql<
    (Omit<SiteFeedRow, 'identifiers'> & {
      identifiers: { scheme: string; value: string }[] | null
    })[]
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

  return rows.map((row) => ({
    ...row,
    identifiers: (row.identifiers ?? []).reduce<LinkedPlaceIdentifier[]>((links, identifier) => {
      // A scheme with no safe URL pattern is dropped rather than linked to a
      // guessed address — see `EXTERNAL_URL_PATTERNS`' own note on the four
      // deliberately unlinked ones.
      const url = buildExternalUrl(identifier.scheme, identifier.value)
      if (url) links.push({ scheme: identifier.scheme, url })
      return links
    }, []),
  }))
}
