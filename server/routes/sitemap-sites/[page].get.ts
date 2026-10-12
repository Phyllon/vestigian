/** One page of the `sites` sitemap — see `SITEMAP_SOURCES` in `server/utils/sitemap-sources.ts`. */
export default defineEventHandler((event) => serveSitemapPage(event, 'sites'))
