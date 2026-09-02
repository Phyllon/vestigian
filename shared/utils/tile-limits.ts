/**
 * The zoom range every tile coordinate in this app is validated against —
 * `server/utils/mvt.ts` for an inbound request, `shared/utils/tiles.ts` for an
 * enumerated offline-download list. One constant, not two copies that could
 * silently disagree about where the pyramid ends.
 */
export const MIN_ZOOM = 0
export const MAX_ZOOM = 18
