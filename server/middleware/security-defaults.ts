/**
 * Two response defaults that `security.headers` in `nuxt.config.ts` cannot
 * actually deliver to every route, verified by curling a running production
 * build directly (no Traefik in front):
 *
 * `cache-control: private, no-store` is the floor every route in this app
 * opts out of, not an afterthought. Before this existed, any route with no
 * `routeRules` entry of its own — most of `server/api/**`, plus every
 * page — left Nitro to send no `cache-control` at all, and Bunny (which sits
 * in front of this app in production) applies its own default edge TTL to a
 * 200 with no instruction otherwise, keyed on the URL alone and blind to the
 * `nuxt-session` cookie riding along in the request. The `/api/sites/**`
 * `routeRules` entry already reasoned about this for one route family; the
 * same risk was silently open on every other one — `/api/me/**`,
 * `auth/export.get.ts` (a full GDPR data export), `/api/moderation/**`,
 * `/api/contributions/**` — none of which had ever been told not to be
 * cached. It matters just as much for the *pages*: every one of them embeds
 * `nuxt-auth-utils`'s session state into its SSR payload, so the rendered
 * HTML for two different visitors is not the same bytes even for a nominally
 * "public" route like `/` or `/site/[slug]`, and each render stamps a fresh
 * nonce into both the CSP header and the inline `<script nonce="...">` tags
 * in the body — a cache that served one response's body against a different
 * response's headers would reproduce, via cache poisoning, the exact
 * "Unfolding the map" blank page documented in CLAUDE.md's "Start here".
 *
 * `cross-origin-resource-policy: same-origin` closes a gap in
 * `nuxt-security`: its `crossOriginResourcePolicy` option (like CSP,
 * `permissionsPolicy`, COOP and COEP) only ever reaches the rendered HTML
 * document — it hooks Nitro's `render:response`, which fires for the page
 * renderer alone (confirmed by reading `nuxt-security@2.6.0`'s own source,
 * not assumed). Every `/api/**` response — a tile, a GeoJSON feed, `/api/me`
 * — was going out with no CORP at all, which is backwards: CORP exists
 * specifically to stop another origin reading a cross-origin subresource
 * (the Spectre-class threat model), and a JSON or MVT response is exactly
 * that subresource, more than the HTML shell ever is.
 *
 * Both belong in `nuxt.config.ts`'s `routeRules['/**']` in spirit, and were
 * tried there first. They don't survive it: `nuxt-security` rebuilds
 * `nitro.routeRules['/**'].headers` from its own `security.headers` config
 * on every build (`getHeadersApplicableToAllResources`, filtered to a fixed
 * allowlist of header names it recognises), which silently drops any other
 * key placed on that same route rule — proven by adding `cache-control` and
 * `cross-origin-resource-policy` there and finding neither in the compiled
 * `.output` bundle, while a third, differently-named key
 * (`strict-transport-security`) placed in the exact same object *did*
 * survive because it happens to be on that allowlist. A plain request
 * middleware sidesteps that rewrite entirely.
 *
 * Registered as a `server/middleware/*` file specifically so it runs before
 * the matched route handler: `getResponseHeader` below only sees headers a
 * `routeRules` entry already applied at this point (Nitro applies those
 * first), never ones a handler sets later, so a handler's own explicit
 * `setResponseHeader('cache-control', …)` — `sites.geojson.get.ts`,
 * `me/bookmarks.get.ts`, every tile route — still wins regardless, simply by
 * running afterwards and overwriting unconditionally.
 *
 * The actual decision is `resolveResponseHeaderDefaults`
 * (`server/utils/response-defaults.ts`) — kept pure and unit-tested there,
 * since this file's h3 event has no equivalent test pattern in this project.
 */
export default defineEventHandler((event) => {
  const defaults = resolveResponseHeaderDefaults(
    getResponseHeader(event, 'cache-control') as string | undefined,
  )
  if (defaults.cacheControl) {
    setResponseHeader(event, 'cache-control', defaults.cacheControl)
  }
  setResponseHeader(event, 'cross-origin-resource-policy', defaults.crossOriginResourcePolicy)
})
