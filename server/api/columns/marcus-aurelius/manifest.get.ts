import { z } from 'zod'

/**
 * Proxies Heidelberg University Library's IIIF Presentation manifest for
 * the Column of Marcus Aurelius plates, server-side.
 *
 * Not optional: a real browser's cross-origin `fetch`/XHR to
 * `digi.ub.uni-heidelberg.de` fails with "Failed to fetch" even though the
 * exact same request succeeds from `curl` and from Node — confirmed by
 * reproducing it directly (Playwright/Chromium, not just reasoning about
 * headers): the response itself never even completes at the network layer
 * (`net::ERR_FAILED`), while a plain top-level page navigation to the same
 * URL, and a server-side request, both return 200 every time. Whatever
 * Heidelberg's infrastructure is doing (a WAF rule keyed on
 * `Sec-Fetch-Mode: cors`, most likely, though not confirmed), it does not
 * apply to a request this project's own server makes — the same reasoning
 * that already routes Wikidata/Wikipedia enrichment through a server proxy
 * rather than a direct browser fetch. See CLAUDE.md's "Column reliefs"
 * section.
 *
 * The manifest's own image-service URLs are rewritten to this project's
 * `tile/[...path]` proxy below, so the browser never needs a second,
 * separate cross-origin request once it has this response — every
 * subsequent info.json and tile image request is same-origin too.
 */
const MANIFEST_URLS: Record<string, string> = {
  'tafeln-i-lxiv':
    'https://digi.ub.uni-heidelberg.de/diglit/iiif/petersen1896tafeln1/manifest.json',
  'tafeln-lxv-cxxviii':
    'https://digi.ub.uni-heidelberg.de/diglit/iiif/petersen1896tafeln2/manifest.json',
}

const UPSTREAM_TILE_PREFIX = 'https://digi.ub.uni-heidelberg.de/iiif/2/'
const PROXY_TILE_PREFIX = '/api/columns/marcus-aurelius/tile/'

export const querySchema = z.object({
  volume: z.enum(['tafeln-i-lxiv', 'tafeln-lxv-cxxviii']),
})

defineRouteMeta({
  openAPI: {
    tags: ['column-reliefs'],
    summary:
      "Proxy Heidelberg University Library's IIIF manifest for a Marcus Aurelius plate volume",
    description:
      'Server-side proxy, not a redirect — a real browser fetch to the upstream host fails; see the docstring on this route.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  const { volume } = await getValidatedQuery(event, querySchema.parse)

  const response = await fetch(MANIFEST_URLS[volume]!)
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      message: 'Heidelberg University Library did not respond.',
    })
  }

  const manifest = await response.text()
  const rewritten = manifest.replaceAll(UPSTREAM_TILE_PREFIX, PROXY_TILE_PREFIX)

  setResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=86400',
  })
  return rewritten
})
