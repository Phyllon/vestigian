import type { SiteDetail } from '#shared/types'

/**
 * The full site record, read once and shared by both routes that serve it.
 *
 * This exists because `sites/slug/[slug]` used to end with
 * `$fetch('/api/sites/:id')` — an internal HTTP round trip back into Nitro. That
 * sub-request carries no socket address, so `getRequestIP` returned undefined
 * and `resolveClientIdentifier` fell through to the literal string `unknown`.
 * Every slug lookup on the instance therefore shared one rate-limit bucket,
 * `rl:record:unknown:<window>`, and a single client could exhaust 300 requests
 * a minute for everybody — a self-inflicted denial of service reachable from an
 * unauthenticated public route.
 *
 * Calling a function instead of an endpoint removes the shared bucket and the
 * wasted round trip together.
 *
 * `viewerId` is optional and only ever affects `endorsedByMe` — every other
 * field, `endorsementCount` included, is identical for every caller. Passing
 * `null` (an anonymous visitor, or a route that chooses not to check) is not
 * a degraded read; it is simply someone `endorsedByMe: false` is correct for.
 */
export const loadSiteDetail = async (
  id: number,
  viewerId: number | null = null,
): Promise<SiteDetail | null> => {
  const sql = useSql()

  const [site] = await sql<
    {
      id: number
      slug: string
      title: string
      category: SiteDetail['category']
      subcategory: string | null
      summary: string | null
      description: string | null
      period_from: number | null
      period_to: number | null
      modern_place: string | null
      country_code: string | null
      lon: number
      lat: number
      updated_at: Date
    }[]
  >`
    SELECT
      s.id, s.slug, s.title, s.category, s.subcategory, s.summary, s.description,
      s.period_from, s.period_to, s.modern_place, s.country_code,
      ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, s.updated_at
    FROM sites s
    WHERE s.id = ${id} AND s.status = 'approved'
    LIMIT 1
  `

  if (!site) return null

  const images = await sql<
    {
      id: number
      storage_key: string
      caption: string | null
      licence: string
      attribution: string | null
      source_url: string | null
      width: number
      height: number
    }[]
  >`
    SELECT id, storage_key, caption, licence, attribution, source_url, width, height
    FROM site_images
    WHERE site_id = ${id} AND status = 'approved'
    ORDER BY sort_order, id
  `

  const identifiers = await sql<
    {
      scheme: string
      value: string
      verified_via: string | null
      verified_distance_metres: number | null
    }[]
  >`
    SELECT e.scheme, e.value, best.checked_via AS verified_via, best.distance_metres AS verified_distance_metres
    FROM external_ids e
    LEFT JOIN LATERAL (
      SELECT checked_via, distance_metres FROM external_id_verifications
      WHERE external_id_id = e.id AND status = 'verified'
      ORDER BY distance_metres ASC NULLS LAST
      LIMIT 1
    ) best ON true
    WHERE e.site_id = ${id}
    ORDER BY e.scheme
  `

  /**
   * One query either way, rather than a count plus a separate existence
   * check. `bool_or(user_id = viewerId)` is `NULL` — not `false` — both when
   * `viewerId` is null (`x = NULL` is never true or false, only unknown, in
   * SQL) and when the site has no endorsements at all (`bool_or` of zero
   * rows is `NULL`), so both cases need the explicit `COALESCE`.
   */
  const [endorsements] = await sql<{ count: string; endorsed_by_me: boolean }[]>`
    SELECT
      count(*)::text AS count,
      COALESCE(bool_or(user_id = ${viewerId}), false) AS endorsed_by_me
    FROM site_endorsements
    WHERE site_id = ${id}
  `

  return {
    id: site.id,
    slug: site.slug,
    title: site.title,
    category: site.category,
    subcategory: site.subcategory,
    summary: site.summary,
    description: site.description,
    periodFrom: site.period_from,
    periodTo: site.period_to,
    modernPlace: site.modern_place,
    countryCode: site.country_code,
    position: { lon: site.lon, lat: site.lat },
    updatedAt: site.updated_at.toISOString(),
    endorsementCount: Number(endorsements?.count ?? 0),
    endorsedByMe: endorsements?.endorsed_by_me ?? false,
    images: images
      .filter((image) => isPublishableLicence(image.licence))
      .map((image) => ({
        id: image.id,
        storageKey: image.storage_key,
        caption: image.caption,
        licence: image.licence,
        attribution: image.attribution,
        sourceUrl: image.source_url,
        width: image.width,
        height: image.height,
      })),
    externalIds: identifiers.map((row) => ({
      scheme: row.scheme,
      value: row.value,
      url: buildExternalUrl(row.scheme, row.value),
      verifiedVia: row.verified_via,
      verifiedDistanceMetres: row.verified_distance_metres,
    })),
  }
}

/**
 * A straight `{prefix}{value}` join. `arachne`, `dare` (fetched live —
 * `imperium.ahlfeldt.se/places/11067.html` loaded and matched its own
 * metadata) and `osmway`/`osmnode` (OpenStreetMap's own well-known,
 * globally stable scheme) are directly confirmed. `omnesviae` is inferred
 * from the importer's own comment on `IDENTIFIER_HOSTS`
 * (`omnesviae.org/#TPPlace…`, `02-mysql-to-postgres.ts`) rather than a fresh
 * fetch — the site is a client-side router keyed off the URL hash, so a
 * static fetch loads only the empty planner shell and cannot confirm a
 * specific place resolves; check by hand in a real browser before trusting
 * this one fully. `dare` and `pecs` need one extra step and are
 * special-cased in `buildExternalUrl` below instead (a trailing `.html`,
 * and a lowercased value, respectively).
 */
const EXTERNAL_URL_PATTERNS: Record<string, string> = {
  pleiades: 'https://pleiades.stoa.org/places/',
  wikidata: 'https://www.wikidata.org/wiki/',
  vici: 'https://vici.org/vici/',
  trismegistos: 'https://www.trismegistos.org/place/',
  arachne: 'https://arachne.dainst.org/entity/',
  // The importer strips a leading "TPPlace" off both the `tp:place=` and the
  // `omnesviae.org/#TPPlace…` spellings onto one bare numeric value, so it has
  // to go back on here — confirmed against the importer's own comment on
  // `IDENTIFIER_HOSTS`, not the omnesviae site's own (undocumented) URL
  // scheme, which a plain web search could not turn up.
  omnesviae: 'https://omnesviae.org/#TPPlace',
  osmway: 'https://www.openstreetmap.org/way/',
  osmnode: 'https://www.openstreetmap.org/node/',
  // The three schemes `scripts/verify-concordances.ts` writes — never from
  // vici's own import, always discovered and verified by that script. The
  // value is exactly what it stored: an EDH findspot id, an iDAI.gazetteer
  // `gazId`, and a Historic England National Heritage List entry number.
  edh: 'https://edh-www.adw.uni-heidelberg.de/edh/geographie/',
  'idai-gazetteer': 'https://gazetteer.dainst.org/place/',
  'historic-england': 'https://historicengland.org.uk/listing/the-list/list-entry/',
}

/**
 * Three recognized schemes are deliberately left without a pattern here,
 * each for a reason found by checking rather than assuming:
 *
 * - `livius` — the stored value is not one consistent shape. Some rows are a
 *   bare last-path-segment slug ("troy", "pompeii" — from a plain URL in
 *   vici's source text), others are "place=…" or "museum=…" pairs from
 *   hand-typed text, and the two need *different* URL prefixes on
 *   livius.org (`/articles/place/{slug}/` vs. `/museum/{slug}`, confirmed by
 *   fetching both) — a category this table doesn't record. A blind pattern
 *   would 404 for a real fraction of the 1,502 rows, which is worse than
 *   today's plain-text fallback.
 * - `mithraeum` — the site's own citation ids look like "TNMM576"; the
 *   values stored here are bare small integers ("1", "100") whose relation
 *   to a resolvable page was not found.
 * - `romaq` — romanaqueducts.info's real entries are addressed by an
 *   aqueduct-name slug (`/aquasite/{name}/`), not the small numeric database
 *   id this project stores.
 * - `archis` — the Dutch national register is behind a professional login
 *   (`archis.cultureelerfgoed.nl/authenticatie/inloggen`); there is no
 *   public per-record page to link to at all.
 *
 * All four still show as a plain "scheme value" fact in
 * `SiteExternalLinks.vue` — unlinked, not hidden.
 */
export const buildExternalUrl = (scheme: string, value: string): string | null => {
  if (scheme === 'wikipedia') {
    const [lang, ...titleParts] = value.split(':')
    const title = titleParts.join(':')
    return lang && title ? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}` : null
  }

  if (scheme === 'pecs') {
    return `http://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.04.0006:id=${encodeURIComponent(value.toLowerCase())}`
  }

  if (scheme === 'dare') {
    return `https://imperium.ahlfeldt.se/places/${encodeURIComponent(value)}.html`
  }

  const prefix = EXTERNAL_URL_PATTERNS[scheme]
  return prefix ? `${prefix}${encodeURIComponent(value)}` : null
}
