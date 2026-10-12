import type { H3Event } from 'h3'
import { asc, count, eq } from 'drizzle-orm'
import {
  atticInscriptions,
  inscriptions,
  isicilyInscriptions,
  sites,
  tracings,
} from '~~/server/database/schema'

type Database = ReturnType<typeof useDatabase>

export interface SitemapRow {
  /** Path on the site, with no origin. */
  path: string
  lastmod?: string
}

export interface SitemapPageWindow {
  limit: number
  offset: number
}

/**
 * One kind of record the sitemap lists a page at a time. `name` is the URL
 * segment — `/sitemap-<name>/<page>` — and what `SITEMAP_DYNAMIC_ROUTES` calls it.
 */
export interface SitemapSource {
  name: string
  count: (database: Database) => Promise<number>
  rows: (database: Database, window: SitemapPageWindow) => Promise<SitemapRow[]>
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * Every source is read in primary-key order, not by `updated_at`. A page is then a
 * fixed run of rows: an edit changes that row's `lastmod`, which is what a crawler
 * reads, and does not carry the row to the front and push 40,000 others across a
 * file boundary — which made Search Console's per-file counts jitter and told a
 * crawler nothing it could not get from `lastmod`.
 *
 * Mirrored corpora carry no `lastmod`: their rows are written by an import, so any
 * date they have is when we last ran it, not when the text changed, and a date
 * that is the same for every URL is worse than none.
 */
export const SITEMAP_SOURCES: readonly SitemapSource[] = [
  {
    name: 'sites',
    count: async (database) => {
      const [row] = await database
        .select({ total: count() })
        .from(sites)
        .where(eq(sites.status, 'approved'))
      return row?.total ?? 0
    },
    rows: async (database, { limit, offset }) => {
      const found = await database
        .select({ slug: sites.slug, updatedAt: sites.updatedAt })
        .from(sites)
        .where(eq(sites.status, 'approved'))
        .orderBy(asc(sites.id))
        .limit(limit)
        .offset(offset)
      return found.map((row) => ({
        path: `/site/${encodeURIComponent(row.slug)}`,
        lastmod: isoDay(row.updatedAt),
      }))
    },
  },
  {
    name: 'tracings',
    count: async (database) => {
      const [row] = await database
        .select({ total: count() })
        .from(tracings)
        .where(eq(tracings.status, 'approved'))
      return row?.total ?? 0
    },
    rows: async (database, { limit, offset }) => {
      const found = await database
        .select({ id: tracings.id, updatedAt: tracings.updatedAt })
        .from(tracings)
        .where(eq(tracings.status, 'approved'))
        .orderBy(asc(tracings.id))
        .limit(limit)
        .offset(offset)
      return found.map((row) => ({
        path: `/tracing/${row.id}`,
        lastmod: isoDay(row.updatedAt),
      }))
    },
  },
  {
    name: 'inscriptions',
    count: async (database) => {
      const [row] = await database.select({ total: count() }).from(inscriptions)
      return row?.total ?? 0
    },
    rows: async (database, { limit, offset }) => {
      const found = await database
        .select({ key: inscriptions.edhId })
        .from(inscriptions)
        .orderBy(asc(inscriptions.id))
        .limit(limit)
        .offset(offset)
      return found.map((row) => ({ path: `/inscriptions/${encodeURIComponent(row.key)}` }))
    },
  },
  {
    name: 'attic-inscriptions',
    count: async (database) => {
      const [row] = await database.select({ total: count() }).from(atticInscriptions)
      return row?.total ?? 0
    },
    rows: async (database, { limit, offset }) => {
      const found = await database
        .select({ key: atticInscriptions.aioKey })
        .from(atticInscriptions)
        .orderBy(asc(atticInscriptions.id))
        .limit(limit)
        .offset(offset)
      return found.map((row) => ({ path: `/inscriptions/attic/${encodeURIComponent(row.key)}` }))
    },
  },
  {
    name: 'isicily-inscriptions',
    count: async (database) => {
      const [row] = await database.select({ total: count() }).from(isicilyInscriptions)
      return row?.total ?? 0
    },
    rows: async (database, { limit, offset }) => {
      const found = await database
        .select({ key: isicilyInscriptions.isicilyId })
        .from(isicilyInscriptions)
        .orderBy(asc(isicilyInscriptions.id))
        .limit(limit)
        .offset(offset)
      return found.map((row) => ({ path: `/inscriptions/sicily/${encodeURIComponent(row.key)}` }))
    },
  },
]

export const findSitemapSource = (name: string): SitemapSource => {
  const source = SITEMAP_SOURCES.find((entry) => entry.name === name)
  if (!source) throw new Error(`No sitemap source named "${name}".`)
  return source
}

/**
 * One page of one source, as the body of `/sitemap-<name>/<page>`.
 *
 * A page past the last is a 404, not an empty file: the index never lists it, so
 * only a guess reaches it, and an empty `<urlset>` served with 200 is a page a
 * crawler may remember. Page 0 always exists, even over no rows.
 */
export const serveSitemapPage = async (event: H3Event, sourceName: string): Promise<string> => {
  await enforceRateLimit(event, 'expensive')

  const page = Number(getRouterParam(event, 'page'))
  if (!Number.isInteger(page) || page < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid sitemap page.' })
  }

  const source = findSitemapSource(sourceName)
  const database = useDatabase()
  const total = await source.count(database)
  if (page >= sitemapPageCount(total)) {
    throw createError({ statusCode: 404, statusMessage: 'No such sitemap page.' })
  }

  const rows = await source.rows(database, {
    limit: SITEMAP_PAGE_SIZE,
    offset: page * SITEMAP_PAGE_SIZE,
  })
  const base = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })

  return buildUrlsetXml(
    rows.map((row) => ({
      loc: `${base}${row.path}`,
      ...(row.lastmod ? { lastmod: row.lastmod } : {}),
    })),
  )
}
