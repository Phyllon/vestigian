import { limesSectors } from '~~/server/database/schema'

/**
 * The hand-written pages (`SITEMAP_STATIC_PATHS`) plus every limes sector — small
 * and static enough that pagination would be overkill, unlike the record sitemaps.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const database = useDatabase()
  const base = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

  const sectors = await database.select({ slug: limesSectors.slug }).from(limesSectors)

  const xml = buildUrlsetXml([
    ...SITEMAP_STATIC_PATHS.map((path) => ({ loc: path === '/' ? `${base}/` : `${base}${path}` })),
    ...sectors.map((sector) => ({ loc: `${base}/limes/${encodeURIComponent(sector.slug)}` })),
  ])

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return xml
})
