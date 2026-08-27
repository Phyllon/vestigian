/**
 * Crawlers that train models are asked to stay out; search engines are welcome.
 *
 * The distinction is the point. This atlas publishes a sitemap of every
 * approved site and an openly licensed GeoJSON feed because it *wants* to be
 * found and reused — blocking indexers would defeat the project. Bulk
 * ingestion for model training is a different act from indexing, and the data's
 * CC BY-SA terms ask for attribution that a trained model does not give.
 *
 * This is a request, not a control: it binds only the crawlers that read it.
 * The measures that actually bind are the rate limits in `ratelimit.ts`.
 */
const MODEL_TRAINING_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'Applebot-Extended',
  'FacebookBot',
  'meta-externalagent',
  'Bytespider',
  'PerplexityBot',
  'Diffbot',
  'Omgilibot',
  'ImagesiftBot',
]

export default defineEventHandler((event) => {
  const { siteUrl } = useRuntimeConfig().public
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')

  // Tiles and the search endpoint are excluded: crawling the tile pyramid would
  // generate millions of requests for content that is worthless in an index.
  const everyone = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/tiles/',
    'Disallow: /api/sites/search',
    'Disallow: /moderation',
    'Disallow: /verify',
    'Disallow: /reset-password',
  ]

  const trainers = MODEL_TRAINING_CRAWLERS.flatMap((agent) => [
    '',
    `User-agent: ${agent}`,
    'Disallow: /',
  ])

  return [...everyone, ...trainers, '', `Sitemap: ${siteUrl.replace(/\/$/, '')}/sitemap.xml`].join(
    '\n',
  )
})
