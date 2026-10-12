/** One page of the `inscriptions` sitemap — see `SITEMAP_SOURCES` in `server/utils/sitemap-sources.ts`. */
export default defineEventHandler((event) => serveSitemapPage(event, 'inscriptions'))
