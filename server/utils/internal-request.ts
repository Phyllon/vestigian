/**
 * Headers that a reverse proxy adds to every request it forwards and that a
 * client cannot remove: Traefik sets the `x-forwarded-*` family itself, and its
 * router rule requires `x-origin-key`, so a request that came through the
 * public front door carries at least one of these.
 *
 * Only their presence is read, never their value — `x-forwarded-for` stays
 * unbelieved everywhere else in this app (see `resolveForwardedIdentifier`).
 *
 * **`x-real-ip` is deliberately not in the list.** The CDN sets it and the
 * rate limiter reads it, which is what the end-to-end suite imitates by
 * sending one on every request — counting it would make `/api/metrics`
 * unreachable to the suite for no gain, since Traefik's own headers above
 * are on every request that came through it.
 */
const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-origin-key',
  'forwarded',
  'cf-connecting-ip',
] as const

/**
 * Whether a request reached the app directly, over the container network —
 * which is how Alloy scrapes `/api/metrics` — rather than through the proxy
 * that faces the internet.
 *
 * This is a second line behind the Traefik `deny-external` middleware, which
 * `docker/traefik/dynamic.yml` itself says may not be loaded by the Traefik
 * Dokploy supplies. Until that is confirmed, "denied at the router" is a hope;
 * this makes the handler true to its own docstring whatever the router does.
 */
export const isDirectRequest = (headers: Record<string, string | string[] | undefined>): boolean =>
  PROXY_HEADERS.every((name) => headers[name] === undefined)
