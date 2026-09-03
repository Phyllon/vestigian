import type { LonLat } from '#shared/types'

/**
 * Talking to the two live external heritage sources this project cross-
 * references against, beyond Wikidata/Pleiades/Wikipedia
 * (`enrichment-sources.ts`). The judgement about what a result means lives
 * in `enrichment.ts`'s `verifyEnrichmentMatch`, unchanged — every candidate
 * from here still has to pass the same distance-and-category gate before
 * anything is recorded as a match.
 *
 * Two sources, not the four originally scoped, and EDH is not a third: it
 * has no live search API at all (confirmed — its only per-record endpoint
 * is a document-by-id DTS lookup returning EpiDoc XML, not JSON, and
 * vici.org's import never captured an `edh` concordance scheme to look
 * documents up by), so it is a bulk import instead
 * (`scripts/import/08-edh-findspots.ts`, joined by identifier in
 * `scripts/verify-concordances.ts`, not fetched here). A fourth,
 * the Portable Antiquities Scheme, was investigated and dropped: its API is
 * behind a Cloudflare bot challenge that refuses a plain server-side
 * request identically to a browser blocked at the edge — not something to
 * route around, the same position this project already takes on
 * vici.org's own crawl-delay.
 *
 * - **iDAI.gazetteer** (DAI) is searched by the site's own title, since
 *   there is no pre-existing `idai-gazetteer` concordance to join by
 *   either. Confirmed live: `search.json?q=` returns real JSON with a
 *   coordinate, a place-type vocabulary, and — usefully — its own
 *   cross-references to Pleiades, Arachne and GeoNames.
 * - **Historic England**'s National Heritage List is an ArcGIS
 *   FeatureServer, OGL-licensed, queried only for sites already resolved to
 *   `GB` (`sites.country_code`, from `scripts/backfill-country-codes.ts`) —
 *   asking a national register about a site nowhere near it would be
 *   exactly the kind of unscoped call this project has avoided everywhere
 *   else (Historic England, PAS and Wikidata's own request-spacing limit
 *   are unrelated administratively, but the discipline is the same).
 */
const USER_AGENT = 'Vestigian/0.1 (https://vestigian.example; atlas of the ancient world)'
const REQUEST_TIMEOUT_MS = 8000

/**
 * Deliberately not `enrichment-sources.ts`'s `request`: that one calls
 * `useLogger()` and `enrichmentRequestsTotal()`, Nitro auto-imports that
 * exist only inside the built server. This file is imported from both a
 * Nitro context and `scripts/verify-concordances.ts`, a standalone `tsx`
 * process with no Nitro runtime behind it at all — the same reason
 * `scripts/import/03-mirror-images.ts` only ever imports genuinely
 * dependency-free functions like `detectImageFormat` from `server/utils/`.
 * `console.warn` works in both; a Nitro auto-import would silently be
 * `undefined` in the script and throw on the first failed request.
 */
const request = async <T>(url: string, source: string): Promise<T | null> => {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.warn(`  [${source}] upstream refused: ${response.status}`)
      return null
    }

    return (await response.json()) as T
  } catch (error) {
    console.warn(`  [${source}] upstream unreachable: ${(error as Error).message}`)
    return null
  }
}

export interface GazetteerCandidate {
  gazId: string
  position: LonLat | null
  placeTypes: string[]
}

interface GazetteerSearchResult {
  result?: {
    gazId: string
    types?: string[]
    prefLocation?: { coordinates?: [number, number] }
  }[]
}

/**
 * `[` and `]` are Solr/Lucene range-query syntax to this endpoint's search —
 * confirmed live: `q=Mithraeum [Londinium]` answers 500, `q=Mithraeum
 * Londinium` (brackets simply dropped) answers 200. A bracketed
 * disambiguator is common in this project's own titles ("Mithraeum
 * [Londinium]", parallel to the parenthesised form "Milecastle 1 (Stott's
 * Pow)", which this endpoint handles fine) and it is the site's own added
 * punctuation, not part of the name — safe to strip rather than escape,
 * since escaping would just search for a literal `[` no title actually
 * contains.
 */
export const sanitizeGazetteerQuery = (title: string): string => title.replace(/[[\]]/g, ' ').trim()

/**
 * Searched by name, not identifier — there is nothing to join by. Only the
 * first hit is used: past that, "which of several same-named results is
 * ours" is exactly the ambiguity `findByStatement` in `enrichment-sources.ts`
 * already refuses to guess at for Wikidata, and the distance/category check
 * downstream is what actually decides whether even the first hit is right.
 */
export const searchGazetteerByName = async (title: string): Promise<GazetteerCandidate | null> => {
  const data = await request<GazetteerSearchResult>(
    `https://gazetteer.dainst.org/search.json?q=${encodeURIComponent(sanitizeGazetteerQuery(title))}`,
    'idai-gazetteer',
  )

  const hit = data?.result?.[0]
  if (!hit) return null

  const coordinates = hit.prefLocation?.coordinates
  return {
    gazId: hit.gazId,
    position: coordinates ? { lon: coordinates[0]!, lat: coordinates[1]! } : null,
    placeTypes: hit.types ?? [],
  }
}

export interface HistoricEnglandCandidate {
  listEntry: number
  name: string
  url: string
  position: LonLat
}

interface ArcGisQueryResult {
  features?: {
    attributes: { Name?: string; ListEntry?: number; hyperlink?: string }
    geometry?: { rings?: [number, number][][] }
  }[]
}

const NHLE_FEATURE_SERVER =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer'

/**
 * Scheduled Monuments (layer 6) only, of the eleven NHLE layers — the one
 * that actually overlaps what this project records (ruins, earthworks,
 * find sites), rather than the standing later-period buildings Listed
 * Building layers are mostly about. Not a general-purpose NHLE client.
 */
const SCHEDULED_MONUMENTS_LAYER = 6

/**
 * A crude centroid — the mean of the first ring's vertices, not a proper
 * area-weighted one. Fine for a typical Scheduled Monument (a fort, a
 * barrow, a villa footprint), where the gap to a true centroid is well
 * inside `verifyEnrichmentMatch`'s 250 m threshold. It is not fine for the
 * genuinely large linear ones — checked live against a real Hadrian's Wall
 * entry spanning three "wall miles", whose vertex-mean centroid sat over a
 * kilometre from a point on the wall itself, which the 250 m gate then
 * correctly refuses. That is an accepted, conservative loss (a real match
 * missed) rather than a wrong one (a false match accepted), and pulling in
 * a geometry library for a proper area-weighted centroid — which would not
 * fully fix this either, since long linear features have no single
 * representative point at all — is not a fix proportionate to how few
 * Scheduled Monuments are shaped like this.
 */
export const ringCentroid = (rings: [number, number][][]): LonLat | null => {
  const ring = rings[0]
  if (!ring || ring.length === 0) return null
  const sum = ring.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon!, lat: acc.lat + lat! }), {
    lon: 0,
    lat: 0,
  })
  return { lon: sum.lon / ring.length, lat: sum.lat / ring.length }
}

export const searchHistoricEnglandNearby = async (
  position: LonLat,
  radiusMetres: number,
): Promise<HistoricEnglandCandidate | null> => {
  const geometry = JSON.stringify({
    x: position.lon,
    y: position.lat,
    spatialReference: { wkid: 4326 },
  })

  const params = new URLSearchParams({
    geometry,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(radiusMetres),
    units: 'esriSRUnit_Meter',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Name,ListEntry,hyperlink',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '1',
    f: 'json',
  })

  const data = await request<ArcGisQueryResult>(
    `${NHLE_FEATURE_SERVER}/${SCHEDULED_MONUMENTS_LAYER}/query?${params.toString()}`,
    'historic-england',
  )

  const feature = data?.features?.[0]
  const rings = feature?.geometry?.rings
  const listEntry = feature?.attributes.ListEntry
  const name = feature?.attributes.Name
  const url = feature?.attributes.hyperlink
  if (!rings || listEntry === undefined || !name || !url) return null

  const centroid = ringCentroid(rings)
  if (!centroid) return null

  return { listEntry, name, url, position: centroid }
}
