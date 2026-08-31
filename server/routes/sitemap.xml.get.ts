import { count, eq } from 'drizzle-orm'
import { sites, tracings } from '~~/server/database/schema'

/**
 * A sitemap index rather than one flat file — sites alone (61k+) already
 * exceed the sitemaps.org 50,000-URL cap per file, and tracings (11.7k) were
 * previously missing from the sitemap entirely. `sitemap-sites/{page}` and
 * `sitemap-tracings/{page}` are the paginated children; `sitemap-static.xml`
 * carries the small, non-paginated hand-written pages and limes sectors.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const config = useRuntimeConfig()
  const database = useDatabase()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const [siteTotal] = await database
    .select({ total: count() })
    .from(sites)
    .where(eq(sites.status, 'approved'))
  const [tracingTotal] = await database
    .select({ total: count() })
    .from(tracings)
    .where(eq(tracings.status, 'approved'))

  const sitePages = paginateOffsets(siteTotal!.total, SITEMAP_PAGE_SIZE).map(
    (offset) => `${base}/sitemap-sites/${offset / SITEMAP_PAGE_SIZE}`,
  )
  const tracingPages = paginateOffsets(tracingTotal!.total, SITEMAP_PAGE_SIZE).map(
    (offset) => `${base}/sitemap-tracings/${offset / SITEMAP_PAGE_SIZE}`,
  )

  const xml = buildSitemapIndexXml([`${base}/sitemap-static.xml`, ...sitePages, ...tracingPages])

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return xml
})
