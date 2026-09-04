import type { LonLat, SiteCategory } from '#shared/types'

/**
 * Deciding whether an outside record describes the same place as one of ours.
 *
 * Everything here is pure so it can be tested without a network, matching the
 * split in `ratelimit.ts` — the fetching lives in `enrichment-sources.ts`.
 *
 * The premise: vici's concordances are a good lead and a poor guarantee.
 * Sampling thirty sites that carry a Wikidata id, the median coordinate
 * agreement was 53 m — but the ninetieth percentile was 1,050 m and the worst
 * was 35.8 km, a Q-id pointing at a modern municipality rather than the fort.
 * Roughly a tenth of them are wrong. So an identifier opens the question and
 * two independent signals close it: where the place is, and what kind of thing
 * it is.
 */

/**
 * How far apart two records may sit and still be called the same place.
 *
 * 250 m accepted 19 of the 29 comparable samples. Tighter (100 m) drops
 * genuine matches on anything large enough that the two projects picked
 * different points — a fort complex, an aqueduct, a walled town. Looser
 * (1 km) starts admitting the neighbouring village.
 */
export const ENRICHMENT_MATCH_METRES = 250

const EARTH_RADIUS_METRES = 6371000

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/**
 * Great-circle distance. The client gets this from MapLibre's
 * `LngLat.distanceTo`, but the server has no equivalent and asking PostGIS to
 * compare two points it does not already hold would be a round trip for one
 * subtraction.
 */
export const metresBetween = (from: LonLat, to: LonLat): number => {
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLon = toRadians(to.lon - from.lon)
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(haversine))
}

/**
 * Wikidata ids as vici actually stored them.
 *
 * `pmeta_extids` was free text, and 97 of 3,495 values did not survive the
 * import cleanly: `q10365480` in lower case, `Q2859241)` with the closing
 * bracket of the surrounding markup still attached. Both are unambiguous, so
 * they are repaired here rather than discarded. Anything else is refused —
 * guessing at a malformed identifier is how you end up describing the wrong
 * ruin.
 */
export const normaliseWikidataId = (value: string | null | undefined): string | null => {
  if (!value) return null
  const trimmed = value
    .trim()
    .replace(/\){1,3}$/, '')
    .toUpperCase()
  return /^Q\d+$/.test(trimmed) ? trimmed : null
}

/**
 * Pleiades place types and Wikidata `instance of` labels, mapped onto our nine
 * categories.
 *
 * Deliberately partial. A term absent from this table yields `unknown`, not a
 * mismatch — the point is to catch a confident contradiction ("we say fort,
 * they say railway station"), never to punish a vocabulary we have not met.
 */
const CATEGORY_BY_PLACE_TYPE: Record<string, SiteCategory> = {
  settlement: 'settlement',
  city: 'settlement',
  town: 'settlement',
  village: 'settlement',
  vicus: 'settlement',
  fort: 'fortification',
  fortlet: 'fortification',
  fortification: 'fortification',
  castellum: 'fortification',
  tower: 'fortification',
  wall: 'fortification',
  temple: 'sanctuary',
  sanctuary: 'sanctuary',
  shrine: 'sanctuary',
  altar: 'sanctuary',
  cemetery: 'burial',
  tomb: 'burial',
  tumulus: 'burial',
  necropolis: 'burial',
  bridge: 'infrastructure',
  road: 'infrastructure',
  aqueduct: 'infrastructure',
  milestone: 'infrastructure',
  port: 'infrastructure',
  villa: 'villa',
  quarry: 'production',
  mine: 'production',
  kiln: 'production',
  production: 'production',
  findspot: 'findspot',
  shipwreck: 'findspot',
}

export type PlaceTypeVerdict = 'compatible' | 'incompatible' | 'unknown'

export interface PlaceTypeRequest {
  category: SiteCategory
  /** Raw vocabulary from the source: Pleiades `placeTypes`, Wikidata P31 labels. */
  placeTypes: string[]
}

/**
 * Whether the outside record agrees about what kind of thing this is.
 *
 * This is the signal a distance check cannot provide. The characteristic
 * failure is a concordance pointing at the modern town that grew over the
 * site: its centre can easily fall inside 250 m, and only the type disagrees.
 *
 * `other` never contradicts anything — it is our bucket for the unclassified,
 * so it carries no claim to be contradicted.
 */
export const checkPlaceType = (request: PlaceTypeRequest): PlaceTypeVerdict => {
  if (request.category === 'other') return 'unknown'

  const mapped = request.placeTypes
    .map((placeType) => CATEGORY_BY_PLACE_TYPE[placeType.trim().toLowerCase()])
    .filter((category): category is SiteCategory => category !== undefined)

  if (mapped.length === 0) return 'unknown'
  return mapped.includes(request.category) ? 'compatible' : 'incompatible'
}

export type EnrichmentRejection =
  'no-coordinate' | 'too-far' | 'wrong-kind-of-place' | 'ambiguous-identifier'

export interface EnrichmentVerdict {
  accepted: boolean
  distanceMetres: number | null
  reason: EnrichmentRejection | null
}

export interface EnrichmentMatchRequest {
  site: { position: LonLat; category: SiteCategory }
  candidate: { position: LonLat | null; placeTypes: string[] }
}

/**
 * The whole judgement, in one place.
 *
 * A candidate with no coordinate is refused rather than accepted on the
 * strength of its identifier alone: the identifier is exactly the thing that
 * turned out to be wrong a tenth of the time, so it cannot also be the thing
 * that vouches for itself.
 */
export const verifyEnrichmentMatch = (request: EnrichmentMatchRequest): EnrichmentVerdict => {
  const { site, candidate } = request

  if (!candidate.position) {
    return { accepted: false, distanceMetres: null, reason: 'no-coordinate' }
  }

  const distanceMetres = metresBetween(site.position, candidate.position)

  if (distanceMetres > ENRICHMENT_MATCH_METRES) {
    return { accepted: false, distanceMetres, reason: 'too-far' }
  }

  const placeType = checkPlaceType({ category: site.category, placeTypes: candidate.placeTypes })

  if (placeType === 'incompatible') {
    return { accepted: false, distanceMetres, reason: 'wrong-kind-of-place' }
  }

  return { accepted: true, distanceMetres, reason: null }
}
