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

export interface SiteDraft {
  title: string
  category: SiteCategory
  summary: string
  description: string
  position: LonLat
  periodFrom: number | null
  periodTo: number | null
}
