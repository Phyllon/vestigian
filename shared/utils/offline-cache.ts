/**
 * The naming contract between the page (which writes tiles into Cache
 * Storage during an explicit "download this area" action) and the service
 * worker (which reads them back when the network is unavailable or slow).
 * Neither side imports the other, so this is the one place both agree on
 * what a downloaded area's cache is called and which requests it is allowed
 * to answer for.
 *
 * Kept framework-free and dependency-free on purpose: `service-worker/sw.ts`
 * is bundled by a separate build step (vite-plugin-pwa's `injectManifest`,
 * not Nuxt's own Vite instance), and importing anything that assumes Nuxt's
 * aliases or auto-imports would be a silent way to break only that build.
 */

const OFFLINE_AREA_CACHE_PREFIX = 'vestigian-offline-area:'

export const cacheNameForArea = (areaId: string): string => `${OFFLINE_AREA_CACHE_PREFIX}${areaId}`

export const isOfflineAreaCacheName = (name: string): boolean =>
  name.startsWith(OFFLINE_AREA_CACHE_PREFIX)

/**
 * The four tile-route families an offline area can contain, matched by path
 * prefix rather than a full URL so the same check works for a relative page
 * fetch and for the absolute URL a service worker's `FetchEvent` carries.
 *
 * `/api/tiles/basemap/` is listed before `/api/tiles/` deliberately — see the
 * test asserting the order matters: a `startsWith` check against `/api/tiles/`
 * alone would also match `/api/tiles/basemap/...` and `/api/tiles/antiquity/...`,
 * which is harmless for routing (all four are cached the same way) but would
 * make `tileLayerForPath` misreport which layer a basemap tile belongs to.
 */
export const TILE_ROUTE_PREFIXES = [
  '/api/tiles/basemap/',
  '/api/tiles/antiquity/',
  '/api/tiles/limes/',
  '/api/tiles/',
] as const

export type TileLayer = 'basemap' | 'antiquity' | 'limes' | 'data'

const LAYER_BY_PREFIX: Record<(typeof TILE_ROUTE_PREFIXES)[number], TileLayer> = {
  '/api/tiles/basemap/': 'basemap',
  '/api/tiles/antiquity/': 'antiquity',
  '/api/tiles/limes/': 'limes',
  '/api/tiles/': 'data',
}

/** Which of the four cacheable layers a request path belongs to, or `null` for anything else. */
export const tileLayerForPath = (pathname: string): TileLayer | null => {
  const prefix = TILE_ROUTE_PREFIXES.find((candidate) => pathname.startsWith(candidate))
  return prefix ? LAYER_BY_PREFIX[prefix] : null
}

export const isTileRequestPath = (pathname: string): boolean => tileLayerForPath(pathname) !== null
