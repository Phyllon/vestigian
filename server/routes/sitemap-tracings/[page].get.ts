import { desc, eq } from 'drizzle-orm'
import { tracings } from '~~/server/database/schema'

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
    .select({ id: tracings.id, updatedAt: tracings.updatedAt })
    .from(tracings)
    .where(eq(tracings.status, 'approved'))
    .orderBy(desc(tracings.updatedAt), desc(tracings.id))
    .limit(SITEMAP_PAGE_SIZE)
    .offset(page * SITEMAP_PAGE_SIZE)

  const xml = buildUrlsetXml(
    rows.map((row) => ({
      loc: `${base}/tracing/${row.id}`,
      lastmod: row.updatedAt.toISOString().slice(0, 10),
    })),
  )

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return xml
})
