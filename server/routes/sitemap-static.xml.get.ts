import { limesSectors } from '~~/server/database/schema'

/**
 * The hand-written pages plus every limes sector — small and static enough
 * that pagination would be overkill, unlike the sites and tracings sitemaps.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const config = useRuntimeConfig()
  const database = useDatabase()

  const sectors = await database.select({ slug: limesSectors.slug }).from(limesSectors)
  const base = config.public.siteUrl.replace(/\/$/, '')

  const xml = buildUrlsetXml([
    { loc: `${base}/` },
    { loc: `${base}/licence` },
    { loc: `${base}/privacy` },
    { loc: `${base}/impressum` },
    { loc: `${base}/limes` },
    ...sectors.map((sector) => ({ loc: `${base}/limes/${sector.slug}` })),
  ])

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return xml
})
