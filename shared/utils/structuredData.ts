/**
 * Pure JSON-LD builders — no Vue dependency, called from a page's
 * `<script setup>` and passed into `useHead`'s `script` array. Kept here
 * rather than in a composable so a malformed payload (a stray `null`, a bad
 * date) is caught by a unit test rather than only ever seen by a crawler.
 */

export interface GeoPoint {
  lat: number
  lon: number
}

export interface SiteJsonLdInput {
  title: string
  summary: string | null
  slug: string
  position: GeoPoint
  modernPlace: string | null
  countryCode: string | null
  updatedAt: string
  siteUrl: string
  imageUrls: string[]
}

export const buildSiteJsonLd = (input: SiteJsonLdInput): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Place',
  name: input.title,
  description: input.summary ?? undefined,
  url: `${input.siteUrl}/site/${input.slug}`,
  geo: {
    '@type': 'GeoCoordinates',
    latitude: input.position.lat,
    longitude: input.position.lon,
  },
  address:
    input.modernPlace || input.countryCode
      ? {
          '@type': 'PostalAddress',
          addressLocality: input.modernPlace ?? undefined,
          addressCountry: input.countryCode ?? undefined,
        }
      : undefined,
  image: input.imageUrls.length > 0 ? input.imageUrls : undefined,
  dateModified: input.updatedAt,
})

export interface TracingJsonLdInput {
  id: number
  title: string
  description: string | null
  updatedAt: string
  siteUrl: string
}

export const buildTracingJsonLd = (input: TracingJsonLdInput): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Place',
  name: input.title,
  description: input.description ?? undefined,
  url: `${input.siteUrl}/tracing/${input.id}`,
  dateModified: input.updatedAt,
})

export interface BreadcrumbItem {
  name: string
  url: string
}

export interface BreadcrumbJsonLdInput {
  items: BreadcrumbItem[]
}

export const buildBreadcrumbJsonLd = (input: BreadcrumbJsonLdInput): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: input.items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: item.url,
  })),
})

export interface WebSiteJsonLdInput {
  siteUrl: string
  name: string
}

export const buildWebSiteJsonLd = (input: WebSiteJsonLdInput): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: input.name,
  url: input.siteUrl,
})
