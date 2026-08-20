/**
 * Sites are the only indexable content here — the map itself is one URL. Capped
 * at the sitemap limit; if the atlas ever outgrows that, this becomes an index
 * pointing at paged children.
 */
const MAX_ENTRIES = 50000

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const sql = useSql()

  const rows = await sql<{ slug: string; updated_at: Date }[]>`
    SELECT slug, updated_at FROM sites
    WHERE status = 'approved'
    ORDER BY updated_at DESC
    LIMIT ${MAX_ENTRIES}
  `

  const base = config.public.siteUrl.replace(/\/$/, '')

  const entries = rows
    .map(
      (row) =>
        `  <url><loc>${base}/site/${row.slug}</loc><lastmod>${row.updated_at.toISOString().slice(0, 10)}</lastmod></url>`,
    )
    .join('\n')

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc></url>
${entries}
</urlset>`
})
