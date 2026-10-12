/** One page of the `tracings` sitemap — see `SITEMAP_SOURCES` in `server/utils/sitemap-sources.ts`. */
export default defineEventHandler((event) => serveSitemapPage(event, 'tracings'))
