/**
 * Proxies a single IIIF Image API request (an `info.json`, or an actual
 * tile image) to Heidelberg University Library, server-side — the same
 * cross-origin restriction documented on `manifest.get.ts` applies here
 * too, and OpenSeadragon fetches both kinds of resource through this same
 * path prefix regardless (`.../info.json` and `.../full/W,/0/default.jpg`
 * both live under Heidelberg's own `/iiif/2/` prefix, so one catch-all
 * route proxies both).
 *
 * `path` is taken as received and appended after Heidelberg's fixed
 * `/iiif/2/` prefix — the manifest proxy already rewrote every URL the
 * client ever sees to point here, so this only ever receives a path that
 * originated from Heidelberg's own manifest in the first place.
 *
 * **An `info.json` response carries its own `@id` field pointing back at
 * Heidelberg**, and OpenSeadragon builds every subsequent tile URL from
 * that field, not from the URL it fetched the document at — rewriting only
 * the manifest's service URLs was not enough, and every actual tile image
 * request bounced straight to `digi.ub.uni-heidelberg.de` again, refused
 * by the CSP (which no longer allowlists that host, correctly, since the
 * browser is never supposed to talk to it directly). Confirmed by watching
 * the real browser console, not by reading the IIIF spec. `info.json`
 * responses get the same string rewrite the manifest already gets; actual
 * tile image bytes pass through untouched.
 */
const UPSTREAM_PREFIX = 'https://digi.ub.uni-heidelberg.de/iiif/2/'
const PROXY_PREFIX = '/api/columns/marcus-aurelius/tile/'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'tiles')
  const path = getRouterParam(event, 'path')
  if (!path) throw createError({ statusCode: 400, message: 'Missing tile path.' })

  const response = await fetch(`${UPSTREAM_PREFIX}${path}`)
  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      message: 'Heidelberg University Library did not respond.',
    })
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  setResponseHeaders(event, {
    'content-type': contentType,
    'cache-control': 'public, max-age=86400',
  })

  if (contentType.includes('json')) {
    const info = await response.text()
    return info.replaceAll(UPSTREAM_PREFIX, PROXY_PREFIX)
  }

  return Buffer.from(await response.arrayBuffer())
})
