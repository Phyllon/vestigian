import type { SiteCategory } from '../types/site'

/**
 * Linked Places Format (LPF) builders — the shape the Pelagios Network reads.
 *
 * Built against the real specification, fetched rather than recalled:
 * https://github.com/LinkedPasts/linked-places-format (v1.3, 24 June 2024).
 * That version matters — it made `fclasses` a *required* field, which a build
 * from memory of the older shape would have silently omitted.
 *
 * LPF supersedes the older Pelagios Gazetteer Interconnection Format and is
 * what Recogito, Peripleo and the World Historical Gazetteer actually consume.
 * It is deliberately also valid GeoJSON, so `/api/data/sites.lp.json` renders
 * in an ordinary map client as well as reconciling in a gazetteer.
 *
 * Pure, and tested in `__test__/linkedPlaces.test.ts`, for the same reason
 * `structuredData.ts` is: a malformed feed is caught here rather than by an
 * aggregator quietly refusing the whole collection months later.
 */

export const LINKED_PLACES_CONTEXT =
  'https://raw.githubusercontent.com/LinkedPasts/linked-places/master/linkedplaces-context-v1.1.jsonld'

/**
 * One of the seven GeoNames feature classes LPF allows, per the v1.3 list.
 *
 * A: administrative · H: water · L: regions · P: populated places
 * R: roads/routes/rail · S: sites (archaeological, buildings, complexes)
 * T: terrestrial landforms
 */
export type FeatureClass = 'A' | 'H' | 'L' | 'P' | 'R' | 'S' | 'T'

/**
 * This atlas's categories onto LPF's seven classes.
 *
 * Only `settlement` is a populated place; everything else this project records
 * is a site in LPF's sense — an archaeological site, building or complex —
 * which is what `S` means and is why it is the honest default rather than a
 * catch-all.
 *
 * `infrastructure` is the one genuinely arguable case: it holds milestones,
 * mansiones, bridges and aqueducts, and `R` (roads, routes, rail) fits the road
 * furniture while `S` fits the structures. It maps to `S` because this feed
 * carries *point* records only — the linear road geometries live in `tracings`
 * and are not published here — and a point is a structure rather than a route.
 */
const FEATURE_CLASS_BY_CATEGORY: Record<SiteCategory, FeatureClass> = {
  settlement: 'P',
  fortification: 'S',
  sanctuary: 'S',
  burial: 'S',
  infrastructure: 'S',
  villa: 'S',
  production: 'S',
  findspot: 'S',
  other: 'S',
}

export const featureClassesFor = (category: SiteCategory): FeatureClass[] => [
  FEATURE_CLASS_BY_CATEGORY[category] ?? 'S',
]

/** The four link relations LPF defines. */
export type LinkRelation = 'closeMatch' | 'exactMatch' | 'primaryTopicOf' | 'seeAlso'

/**
 * Which relation a concordance scheme earns.
 *
 * `closeMatch` is the default and is what LPF calls "the principal means of
 * linking places and gazetteer datasets" — it asserts the two records are about
 * the same place without claiming the descriptions are interchangeable.
 *
 * `exactMatch` is deliberately never emitted. Nothing in this project has ever
 * established that a Vestigian record and a Pleiades record are the *same
 * resource* to that strength; the identifiers were parsed out of vici.org's
 * free-text `pmeta_extids` or discovered by `verify-concordances.ts` against a
 * distance-and-category gate. That is good evidence of "the same place", which
 * is precisely `closeMatch`, and not evidence of identity.
 *
 * Wikipedia is `primaryTopicOf` rather than a match: an encyclopaedia article
 * is a document *about* the place, not another gazetteer's record of it.
 */
const LINK_RELATION_BY_SCHEME: Record<string, LinkRelation> = {
  wikipedia: 'primaryTopicOf',
}

export const linkRelationFor = (scheme: string): LinkRelation =>
  LINK_RELATION_BY_SCHEME[scheme] ?? 'closeMatch'

/**
 * A year as an ISO 8601 calendar year, zero-padded to the four digits LPF's
 * OWL-Time values expect: 70 → `0070`, -12 → `-0012`.
 *
 * The source's own numbering is preserved rather than reinterpreted. Strict ISO
 * 8601 uses astronomical year numbering, where year 0 is 1 BC and 12 BC is
 * therefore `-0011` — so converting would shift every BC date in the atlas by
 * one. Whether vici.org's `pmeta_startyr` is already astronomical or is plain
 * historical numbering is not stated anywhere in that source, and silently
 * re-basing 31,368 dated records on a guess is a far worse error than carrying
 * the source's convention forward unchanged. A one-year ambiguity on dates that
 * are themselves usually round-century estimates is the smaller harm, and it is
 * one a consumer can correct if the convention is ever established.
 */
export const toIsoYear = (year: number): string => {
  const padded = String(Math.abs(Math.trunc(year))).padStart(4, '0')
  return year < 0 ? `-${padded}` : padded
}

export interface LinkedPlaceIdentifier {
  /** The concordance scheme, e.g. `pleiades`, `wikidata`. */
  scheme: string
  /** Already resolved to an absolute URL by the caller — see `buildExternalUrl`. */
  url: string
}

export interface LinkedPlaceInput {
  /** This record's own canonical, dereferenceable URI. */
  id: string
  title: string
  category: SiteCategory
  longitude: number
  latitude: number
  countryCode: string | null
  summary: string | null
  periodFrom: number | null
  periodTo: number | null
  identifiers: LinkedPlaceIdentifier[]
  /** Licence of the textual description, surfaced so reuse carries its terms. */
  licence: string
  attribution: string | null
}

/**
 * One LPF Feature.
 *
 * **Conformance note, stated plainly because it is a real gap rather than an
 * oversight.** LPF requires a `when` element on every Feature. Only 31,368 of
 * this atlas's 61,273 published sites carry any dating at all; the other 29,905
 * have none, because the source never recorded one. Those features are emitted
 * *without* `when`.
 *
 * The alternative was inventing a temporal scope — a blanket "Roman period"
 * span, say — for half the atlas. A gazetteer that fabricates dating is worse
 * than one that admits what it does not know, and an aggregator can filter on a
 * missing field far more easily than it can detect a plausible invented one.
 * Consumers that require strict v1.3 conformance should treat the dated subset
 * as the conformant feed.
 */
export const buildLinkedPlaceFeature = (input: LinkedPlaceInput): Record<string, unknown> => {
  const timespan = buildTimespan(input.periodFrom, input.periodTo)

  return {
    '@id': input.id,
    type: 'Feature',
    properties: {
      title: input.title,
      // Encouraged, not required, and omitted rather than guessed when the
      // point-in-polygon lookup in `revisions.ts` found no country.
      ccodes: input.countryCode ? [input.countryCode] : undefined,
      fclasses: featureClassesFor(input.category),
    },
    // The one name this project holds. LPF wants every attested variant with
    // citations; there is no attestation apparatus here, so one uncited
    // toponym is what can honestly be offered.
    names: [{ toponym: input.title, lang: 'en' }],
    when: timespan ? { timespans: [timespan] } : undefined,
    geometry: { type: 'Point', coordinates: [input.longitude, input.latitude] },
    links: input.identifiers.map((identifier) => ({
      type: linkRelationFor(identifier.scheme),
      identifier: identifier.url,
    })),
    descriptions: input.summary
      ? [{ value: input.summary, lang: 'en', source: input.id, license: input.licence }]
      : undefined,
    // Not an LPF term. Carried anyway because the descriptions above are
    // CC BY-SA and an aggregator that drops attribution breaks that licence;
    // an unknown key is ignored by a JSON-LD processor rather than invalidating
    // the record.
    attribution: input.attribution ?? undefined,
  }
}

/**
 * LPF timespans need a start; an end alone is not expressible. A record dated
 * only by its end year therefore uses that year as both bounds rather than
 * being dropped — it is the narrowest claim the data actually supports.
 */
const buildTimespan = (
  periodFrom: number | null,
  periodTo: number | null,
): { start: { in: string }; end?: { in: string } } | null => {
  if (periodFrom === null && periodTo === null) return null

  const start = periodFrom ?? periodTo
  if (start === null) return null

  return {
    start: { in: toIsoYear(start) },
    end: periodTo === null ? undefined : { in: toIsoYear(periodTo) },
  }
}

export const buildLinkedPlacesCollection = (
  features: Record<string, unknown>[],
): Record<string, unknown> => ({
  type: 'FeatureCollection',
  '@context': LINKED_PLACES_CONTEXT,
  features,
})
