import { desc, eq } from 'drizzle-orm'
import { limesSectors, sites } from '~~/server/database/schema'

/**
 * Sites and the frontier sectors are the indexable content — the map itself is
 * one URL. Capped at the sitemap limit; if the atlas ever outgrows that, this
 * becomes an index pointing at paged children.
 */
const MAX_ENTRIES = 50000

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const config = useRuntimeConfig()
  const database = useDatabase()

  const rows = await database
    .select({ slug: sites.slug, updatedAt: sites.updatedAt })
    .from(sites)
    .where(eq(sites.status, 'approved'))
    .orderBy(desc(sites.updatedAt))
    .limit(MAX_ENTRIES)

  // Seventeen rows, and they change only when the frontier is re-imported.
  const sectors = await database.select({ slug: limesSectors.slug }).from(limesSectors)

  const base = config.public.siteUrl.replace(/\/$/, '')

  const entries = rows
    .map(
      (row) =>
        `  <url><loc>${base}/site/${row.slug}</loc><lastmod>${row.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`,
    )
    .join('\n')

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc></url>
  <url><loc>${base}/licence</loc></url>
  <url><loc>${base}/privacy</loc></url>
  <url><loc>${base}/impressum</loc></url>
  <url><loc>${base}/limes</loc></url>
${sectors.map((row) => `  <url><loc>${base}/limes/${row.slug}</loc></url>`).join('\n')}
${entries}
</urlset>`
})
