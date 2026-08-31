import { desc, eq } from 'drizzle-orm'
import { sites } from '~~/server/database/schema'

/**
 * `[page].get.ts` rather than a literal `.xml` in the filename — mirrors the
 * tiles routes' `[y].get.ts`, the only precedent in this codebase for a
 * bracket param sharing a path segment with anything else, and the content
 * type is set explicitly below regardless of the URL's own extension.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'expensive')
  const page = Number(getRouterParam(event, 'page'))
  if (!Number.isInteger(page) || page < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid sitemap page.' })
  }

  const config = useRuntimeConfig()
  const database = useDatabase()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const rows = await database
    .select({ slug: sites.slug, id: sites.id, updatedAt: sites.updatedAt })
    .from(sites)
    .where(eq(sites.status, 'approved'))
    // `id` breaks ties among rows sharing an `updatedAt` — common in
    // bulk-imported data — so a row is never skipped or duplicated across a
    // page boundary.
    .orderBy(desc(sites.updatedAt), desc(sites.id))
    .limit(SITEMAP_PAGE_SIZE)
    .offset(page * SITEMAP_PAGE_SIZE)

  const xml = buildUrlsetXml(
    rows.map((row) => ({
      loc: `${base}/site/${row.slug}`,
      lastmod: row.updatedAt.toISOString().slice(0, 10),
    })),
  )

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return xml
})
