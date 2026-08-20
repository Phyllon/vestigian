import { z } from 'zod'
import type { SiteDetail } from '#shared/types'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

/**
 * Full record for one site. Tiles carry only an identifier and a label, so this
 * is what the detail panel opens with. Images with an unresolved licence are
 * filtered out here rather than at render time.
 */
export default defineEventHandler(async (event): Promise<SiteDetail> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const sql = useSql()

  const [site] = await sql<
    {
      id: number
      slug: string
      title: string
      category: SiteDetail['category']
      summary: string | null
      description: string | null
      period_from: number | null
      period_to: number | null
      modern_place: string | null
      country_code: string | null
      lon: number
      lat: number
      updated_at: Date
    }[]
  >`
    SELECT
      s.id, s.slug, s.title, s.category, s.summary, s.description,
      s.period_from, s.period_to, s.modern_place, s.country_code,
      ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, s.updated_at
    FROM sites s
    WHERE s.id = ${id} AND s.status = 'approved'
    LIMIT 1
  `

  if (!site) {
    throw createError({ statusCode: 404, message: 'No approved site with that identifier.' })
  }

  const images = await sql<
    {
      id: number
      storage_key: string
      caption: string | null
      licence: string
      attribution: string | null
      source_url: string | null
      width: number
      height: number
    }[]
  >`
    SELECT id, storage_key, caption, licence, attribution, source_url, width, height
    FROM site_images
    WHERE site_id = ${id} AND status = 'approved'
    ORDER BY sort_order, id
  `

  const identifiers = await sql<{ scheme: string; value: string }[]>`
    SELECT scheme, value FROM external_ids WHERE site_id = ${id} ORDER BY scheme
  `

  return {
    id: site.id,
    slug: site.slug,
    title: site.title,
    category: site.category,
    summary: site.summary,
    description: site.description,
    periodFrom: site.period_from,
    periodTo: site.period_to,
    modernPlace: site.modern_place,
    countryCode: site.country_code,
    position: { lon: site.lon, lat: site.lat },
    updatedAt: site.updated_at.toISOString(),
    images: images
      .filter((image) => isPublishableLicence(image.licence))
      .map((image) => ({
        id: image.id,
        storageKey: image.storage_key,
        caption: image.caption,
        licence: image.licence,
        attribution: image.attribution,
        sourceUrl: image.source_url,
        width: image.width,
        height: image.height,
      })),
    externalIds: identifiers.map((row) => ({
      scheme: row.scheme,
      value: row.value,
      url: buildExternalUrl(row.scheme, row.value),
    })),
  }
})

const EXTERNAL_URL_PATTERNS: Record<string, string> = {
  pleiades: 'https://pleiades.stoa.org/places/',
  wikidata: 'https://www.wikidata.org/wiki/',
  vici: 'https://vici.org/vici/',
  trismegistos: 'https://www.trismegistos.org/place/',
}

const buildExternalUrl = (scheme: string, value: string): string | null => {
  const prefix = EXTERNAL_URL_PATTERNS[scheme]
  return prefix ? `${prefix}${encodeURIComponent(value)}` : null
}
