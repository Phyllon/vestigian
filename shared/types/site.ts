/**
 * Domain vocabulary shared by the Nuxt app and the Nitro server.
 * Anything crossing the network boundary is defined here exactly once.
 */

export type SiteCategory =
  | 'settlement'
  | 'fortification'
  | 'sanctuary'
  | 'burial'
  | 'infrastructure'
  | 'villa'
  | 'production'
  | 'findspot'
  | 'other'

export type GeometryKind = 'point' | 'line' | 'area'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type ContributionKind = 'site' | 'image' | 'tracing'

export interface LonLat {
  lon: number
  lat: number
}

export interface BoundingBox {
  west: number
  south: number
  east: number
  north: number
}

export interface TileCoordinate {
  z: number
  x: number
  y: number
}

export interface SiteSummary {
  id: number
  slug: string
  title: string
  category: SiteCategory
  position: LonLat
}

export interface SiteImage {
  id: number
  storageKey: string
  caption: string | null
  licence: string
  attribution: string | null
  sourceUrl: string | null
  width: number
  height: number
}

export interface SiteDetail extends SiteSummary {
  summary: string | null
  description: string | null
  periodFrom: number | null
  periodTo: number | null
  modernPlace: string | null
  countryCode: string | null
  images: SiteImage[]
  externalIds: ExternalIdentifier[]
  updatedAt: string
}

export interface ExternalIdentifier {
  scheme: string
  value: string
  url: string | null
}

/** Which concordance got us from a site to an external entity. */
export type EnrichmentRoute = 'wikidata' | 'pleiades' | 'dare'

/**
 * Borrowed prose about a site, shown only when it is certainly the same place.
 *
 * `matchedVia` and `matchedWithinMetres` travel with the text on purpose. This
 * is third-party content in a curated atlas, so the panel can say *why* it
 * believes the two records describe one place rather than asking the reader to
 * take it on trust.
 */
export interface SiteEnrichment {
  title: string
  extract: string
  articleUrl: string
  /**
   * The Wikipedia the extract came from, as a language code. English is
   * preferred and Dutch is the fallback — much of this atlas is Dutch ground,
   * and `nl` carries an article where `en` has none for a quarter of the sites
   * that can be matched at all. The panel labels anything that is not English
   * rather than passing it off as translated.
   */
  language: string
  /** Attribution is rendered, never implied — the licence demands it. */
  source: string
  licence: string
  matchedVia: EnrichmentRoute
  matchedWithinMetres: number
}

export interface SiteDraft {
  title: string
  category: SiteCategory
  summary: string
  description: string
  position: LonLat
  periodFrom: number | null
  periodTo: number | null
}

/**
 * The fixed set of derivative sizes. A preset name crosses the network — the
 * client asks for one by name and the server turns it into geometry — so the
 * table lives here rather than on either side of the boundary. Arbitrary
 * dimensions are deliberately not offered: they would make the imgproxy cache
 * unbounded and let a caller drive the image server's CPU.
 */
export type ImagePreset = 'thumb' | 'card' | 'full'

export interface ImagePresetSize {
  width: number
  height: number
  fit: 'cover' | 'contain'
}

export const IMAGE_PRESETS: Record<ImagePreset, ImagePresetSize> = {
  thumb: { width: 160, height: 160, fit: 'cover' },
  card: { width: 720, height: 480, fit: 'cover' },
  full: { width: 1600, height: 1600, fit: 'contain' },
}
