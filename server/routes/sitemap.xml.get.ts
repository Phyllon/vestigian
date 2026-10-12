/**
 * A sitemap index rather than one flat file: the records alone are about 160,000
 * URLs against sitemaps.org's cap of 50,000 per file. `sitemap-static.xml` carries
 * the hand-written pages and the limes sectors; every other child is one kind of
 * record, paginated by `SITEMAP_PAGE_SIZE` — see `SITEMAP_SOURCES`.
 *
 * The child list is computed from the row counts on every request (cached for an
 * hour), so a corpus that grows past a file's worth gains a page by itself. Nothing
 * here needs touching until an index would hold 50,000 files, which at 40,000 URLs
 * each is two billion records.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const database = useDatabase()
  const base = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

  const totals = await Promise.all(SITEMAP_SOURCES.map((source) => source.count(database)))
  const children = SITEMAP_SOURCES.flatMap((source, index) =>
    Array.from(
      { length: sitemapPageCount(totals[index] ?? 0) },
      (_, page) => `${base}/sitemap-${source.name}/${page}`,
    ),
  )

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return buildSitemapIndexXml([`${base}/sitemap-static.xml`, ...children])
})
