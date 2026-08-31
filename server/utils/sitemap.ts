/**
 * XML for the sitemap index and its child `<urlset>` files. Split out from the
 * routes because the pure pagination and escaping logic is what can silently
 * go wrong — dropping rows at a page boundary, or a `&` in an imported title
 * breaking the XML — and that's worth testing without a database.
 */

/**
 * Well under the sitemap protocol's 50,000-URL cap, leaving headroom for the
 * file to also stay under the 50MB limit even with long titles/slugs.
 */
export const SITEMAP_PAGE_SIZE = 40000

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
