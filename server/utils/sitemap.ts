/**
 * XML for the sitemap index and its child `<urlset>` files. Split out from the
 * routes because the pure pagination and escaping logic is what can silently
 * go wrong — dropping rows at a page boundary, or a `&` in an imported title
 * breaking the XML — and that's worth testing without a database.
 */

/**
 * What sitemaps.org allows: one file holds at most 50,000 URLs and 50 MiB
 * uncompressed, and one index at most 50,000 sitemaps. An index may not list
 * another index, so 50,000 × 50,000 URLs is the ceiling of a single index file.
 */
export const SITEMAP_PROTOCOL_MAX_ENTRIES = 50_000

/**
 * Under the 50,000-URL cap with room to spare, and a full file stays far inside
 * 50 MiB: an entry is about 110 bytes for a typical slug and ~250 for the longest
 * the schema allows, so 40,000 of them are 4–10 MB.
 */
export const SITEMAP_PAGE_SIZE = 40_000

const assertWithinProtocolLimit = (entryCount: number, what: string): void => {
  // Loud rather than quietly truncated: a file over the limit is rejected whole by
  // a crawler, and everything in it disappears from the index without a trace.
  if (entryCount > SITEMAP_PROTOCOL_MAX_ENTRIES) {
    throw new Error(
      `A sitemap ${what} may list at most ${SITEMAP_PROTOCOL_MAX_ENTRIES} entries, got ${entryCount}.`,
    )
  }
}

export interface SitemapUrlEntry {
  loc: string
  lastmod?: string
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export const buildUrlsetXml = (entries: SitemapUrlEntry[]): string => {
  assertWithinProtocolLimit(entries.length, 'file')
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''
      return `  <url><loc>${escapeXml(entry.loc)}</loc>${lastmod}</url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

export const buildSitemapIndexXml = (childUrls: string[]): string => {
  assertWithinProtocolLimit(childUrls.length, 'index')
  const sitemaps = childUrls
    .map((url) => `  <sitemap><loc>${escapeXml(url)}</loc></sitemap>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`
}

/**
 * Offsets for pages of `pageSize` rows over `totalCount` rows — `[0]` for
 * zero rows too, so a paginated sitemap always has at least one (empty) page
 * rather than a broken sitemapindex entry pointing at nothing.
 */
export const paginateOffsets = (totalCount: number, pageSize: number): number[] => {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  return Array.from({ length: pageCount }, (_, page) => page * pageSize)
}

/** How many files `totalCount` rows need — at least one, as in `paginateOffsets`. */
export const sitemapPageCount = (
  totalCount: number,
  pageSize: number = SITEMAP_PAGE_SIZE,
): number => Math.max(1, Math.ceil(totalCount / pageSize))
