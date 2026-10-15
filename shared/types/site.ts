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
  /** Set by the search endpoints only; see `server/utils/search-relevance.ts`. */
  relevance?: number
}

/**
 * A site picked out for the "featured nearby" list — derived, not flagged; see
 * `shared/utils/featured.ts`. `thumbnailImageId` is always present because a
 * record without a published photograph is never featured.
 *
 * The fields below `thumbnailImageId` are what the list's "big picture" size
 * adds to a row. They ride along on every response rather than behind a second
 * request: the endpoint returns at most eight rows, so it is a few hundred bytes.
 */
export interface FeaturedSiteSummary {
  id: number
  slug: string
  title: string
  category: SiteCategory
  countryCode: string | null
  position: LonLat
  distanceMetres: number
  thumbnailImageId: number
  /** Cut at a word by `excerptSummary`; the full text is in the record panel. */
  summary: string | null
  periodFrom: number | null
  periodTo: number | null
  modernPlace: string | null
  /** Published photographs only — the count a reader would find in the gallery. */
  imageCount: number
  endorsementCount: number
  /** The leading photograph's credit; a larger picture owes its reader the line the gallery prints. */
  thumbnailAttribution: string | null
  thumbnailLicence: string
}

/**
 * A modern city or town — GeoNames.org's `cities500` extract
 * (`scripts/import/09-cities.ts`), not a Vestigian record. Exists only to
 * let the map search bar navigate to a place this atlas holds no opinion
 * about, which is why it carries no `slug`: there is no page for it.
 */
export interface PlaceSummary {
  id: number
  name: string
  countryCode: string
  position: LonLat
  /** Set by the search endpoints only; see `server/utils/search-relevance.ts`. */
  relevance?: number
}

/**
 * An ancient name from AWMC/Pleiades' gazetteer (`antiquity_places`,
 * `scripts/import/05-antiquity-atlas.ts`) — the names drawn on the
 * Barrington sheet, e.g. "Bratananium" near modern Gauting. Not a
 * Vestigian record, the same reasoning as `PlaceSummary`: no slug, no
 * page, just somewhere on the map worth being able to find by name.
 * `category` is nullable because Pleiades has landscape features with a
 * name and no symbol on the sheet — still findable by name, but with
 * nothing to badge them as.
 */
export interface AncientPlaceSummary {
  id: number
  title: string
  category: SiteCategory | null
  position: LonLat
  /** Set by the search endpoints only; see `server/utils/search-relevance.ts`. */
  relevance?: number
}

/**
 * The borrowed reference layers the map search can find by name, one value per
 * source table (`server/utils/reference-search.ts`). Each is also an overlay
 * the reader can switch on, which is what `useRevealSearchLayer` does when a
 * result is picked.
 */
export type ReferenceSearchLayer =
  | 'hillfort'
  | 'port'
  | 'monument'
  | 'mint'
  | 'battle'
  | 'coin-hoard'
  | 'feature'
  | 'tabula-place'
  | 'survey-site'

/**
 * A named point from one of the reference layers (hillforts, ports, monuments
 * and the rest). Not a Vestigian record, the same reasoning as
 * `AncientPlaceSummary`: no page of its own, so picking one moves the camera
 * there and switches its layer on. `id` is unique only within its `layer`.
 */
export interface ReferenceSearchSummary {
  id: number
  layer: ReferenceSearchLayer
  title: string
  position: LonLat
  /** Set by the search endpoints only; see `server/utils/search-relevance.ts`. */
  relevance?: number
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
  /**
   * The source's own word for what this is (`watchtower`, `fort`, `milestone`…),
   * where it had one. Free text — the vocabulary is the source's, not ours.
   */
  subcategory: string | null
  summary: string | null
  description: string | null
  periodFrom: number | null
  periodTo: number | null
  modernPlace: string | null
  countryCode: string | null
  images: SiteImage[]
  externalIds: ExternalIdentifier[]
  updatedAt: string
  /** How many signed-in readers have marked this "found useful". Always public. */
  endorsementCount: number
  /**
   * Whether the caller themselves has. `false` for a signed-out visitor —
   * never `null` or omitted, so a template can bind to it directly without a
   * separate "do we even know" branch.
   */
  endorsedByMe: boolean
}

export interface ExternalIdentifier {
  scheme: string
  value: string
  url: string | null
  /**
   * A source this identifier has been checked against, and how far its
   * coordinate sat from this site's own — `null` when nothing has verified
   * it yet, which is not the same as "wrong", only "unchecked"
   * (`scripts/verify-concordances.ts`; `server/utils/enrichment.ts` for
   * Wikidata itself, though that one is not persisted — see its own note).
   */
  verifiedVia: string | null
  verifiedDistanceMetres: number | null
}

/** Which concordance got us from a site to an external entity. */
export type EnrichmentRoute = 'wikidata' | 'pleiades' | 'dare'

/**
 * Wikipedias this atlas can read and LibreTranslate can translate between —
 * the same six the interface itself is offered in. Shared so the client's
 * `lang` query parameter and the server's article-language preference and
 * translation target can never drift into different vocabularies.
 */
export const ENRICHMENT_LANGUAGES = ['en', 'nl', 'de', 'es', 'it', 'fr'] as const

export type EnrichmentLanguage = (typeof ENRICHMENT_LANGUAGES)[number]

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
   * The language `extract` is actually in — after translation, if any. English
   * is preferred, then `nl`, `de`, `es`, `it`, the languages this atlas is
   * written over.
   */
  language: string
  /**
   * Where the words started, before any machine translation. Equal to
   * `language` when nothing was translated.
   */
  originalLanguage: string
  /**
   * True when a machine put those words into `language`. Rendered, never
   * hidden: a translation of a CC BY-SA text is still that text's derivative,
   * and a reader deserves to know a machine stood between them and the source.
   */
  isMachineTranslated: boolean
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
export type ImagePreset = 'thumb' | 'card' | 'full' | 'og'

export interface ImagePresetSize {
  width: number
  height: number
  fit: 'cover' | 'contain'
}

export const IMAGE_PRESETS: Record<ImagePreset, ImagePresetSize> = {
  thumb: { width: 160, height: 160, fit: 'cover' },
  card: { width: 720, height: 480, fit: 'cover' },
  full: { width: 1600, height: 1600, fit: 'contain' },
  // The Open Graph protocol's documented recommended size, so a shared card
  // renders crisp rather than upscaled on every major platform.
  og: { width: 1200, height: 630, fit: 'cover' },
}
