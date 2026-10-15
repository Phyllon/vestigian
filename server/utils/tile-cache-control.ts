/**
 * The `cache-control` a tile response carries.
 *
 * A tile URL has no data generation in it, so whatever lifetime is sent here is how long a browser
 * (and, in production, the CDN) keeps a tile whatever happens in the database in the meantime.
 * Production wants the long lifetime. Development does not: an import runs, the server and Valkey
 * are right, and the browser keeps the tile it fetched *before* the import — so a layer looks
 * missing at the zooms already visited and present at the ones not (reported for the dated
 * survey sites, 15 Oct 2026). Under `nuxt dev` every tile is therefore revalidated; nothing changes
 * in a build.
 */
const ATLAS_TILE_PRODUCTION = 'public, max-age=86400, stale-while-revalidate=604800'
const SITE_TILE_PRODUCTION = 'public, max-age=3600, stale-while-revalidate=86400'

/** Atlas, reference and overlay tiles: reference data, rebuilt wholesale by an import. */
export const atlasTileCacheControl = (): string =>
  import.meta.dev ? 'no-cache' : ATLAS_TILE_PRODUCTION

/** Contributed site and tracing tiles: edited records, so a shorter production lifetime. */
export const siteTileCacheControl = (): string =>
  import.meta.dev ? 'no-cache' : SITE_TILE_PRODUCTION
