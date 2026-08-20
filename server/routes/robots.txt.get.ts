export default defineEventHandler((event) => {
  const { siteUrl } = useRuntimeConfig().public
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')

  // Tiles and the search endpoint are excluded: crawling the tile pyramid would
  // generate millions of requests for content that is worthless in an index.
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/tiles/',
    'Disallow: /api/sites/search',
    'Disallow: /moderation',
    'Disallow: /verify',
    'Disallow: /reset-password',
    '',
    `Sitemap: ${siteUrl.replace(/\/$/, '')}/sitemap.xml`,
  ].join('\n')
})
