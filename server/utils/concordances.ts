import type { SiteCategory } from '#shared/types'
import { verifyEnrichmentMatch } from './enrichment'
import { searchGazetteerByName, searchHistoricEnglandNearby } from './concordance-sources'

/**
 * Runs the same EDH / iDAI.gazetteer / Historic England checks
 * `scripts/verify-concordances.ts` runs in bulk, for exactly one site, right
 * after it publishes — called from `applyRevision()`, fire-and-forget. A
 * slow or unreachable upstream must never hold up a contribution's approval,
 * the same fail-open reasoning already applied to rate limiting and mail
 * delivery elsewhere in this codebase, so the caller never awaits this.
 *
 * This file uses `useSql()`/`useLogger()` (Nitro auto-imports) and therefore
 * cannot be imported by `scripts/verify-concordances.ts`, a standalone `tsx`
 * process with no Nitro runtime behind it — the same split
 * `concordance-sources.ts`'s own docstring explains for `request()`. The
 * bulk script stays the only way to backfill sites that existed before this
 * hook did (and the only one worth using for a full-catalog run — one search
 * per site, paced, is still an overnight-scale operation at 61k rows).
 */

const HISTORIC_ENGLAND_SEARCH_RADIUS_METRES = 500

interface ConcordanceSite {
  id: number
  title: string
  category: SiteCategory
  lon: number
  lat: number
  countryCode: string | null
  pleiadesId: string | null
  trismegistosId: string | null
}

interface ConcordanceMatch {
  siteId: number
  scheme: string
  value: string
  distanceMetres: number
}

/**
 * `ON CONFLICT … RETURNING id` rather than `DO NOTHING`, because a plain
 * insert-or-skip would never hand back the id of an already-existing row for
 * the verification insert that follows — an edited site re-running this
 * hook against the same identifier is the normal case, not an edge case.
 */
const recordConcordanceMatch = async (match: ConcordanceMatch): Promise<void> => {
  const sql = useSql()
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO external_ids (site_id, scheme, value)
    VALUES (${match.siteId}, ${match.scheme}, ${match.value})
    ON CONFLICT (site_id, scheme, value) DO UPDATE SET value = EXCLUDED.value
    RETURNING id
  `

  await sql`
    INSERT INTO external_id_verifications (external_id_id, status, distance_metres, checked_via)
    VALUES (${row!.id}, 'verified', ${Math.round(match.distanceMetres)}, ${match.scheme})
    ON CONFLICT (external_id_id, checked_via)
    DO UPDATE SET status = 'verified', distance_metres = EXCLUDED.distance_metres, checked_at = now()
  `
}

const verifySiteAgainstEdh = async (site: ConcordanceSite): Promise<void> => {
  if (!site.pleiadesId && !site.trismegistosId) return

  const sql = useSql()
  const [findspot] = await sql<{ edhUri: string; lon: number; lat: number }[]>`
    SELECT edh_uri AS "edhUri", ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM edh_findspots
    WHERE pleiades_id = ${site.pleiadesId} OR trismegistos_id = ${site.trismegistosId}
    LIMIT 1
  `
  if (!findspot) return

  const verdict = verifyEnrichmentMatch({
    site: { position: { lon: site.lon, lat: site.lat }, category: site.category },
    candidate: { position: { lon: findspot.lon, lat: findspot.lat }, placeTypes: [] },
  })
  if (!verdict.accepted) return

  const edhId = /\/(\d+)\/?$/.exec(findspot.edhUri)?.[1] ?? findspot.edhUri
  await recordConcordanceMatch({
    siteId: site.id,
    scheme: 'edh',
    value: edhId,
    distanceMetres: verdict.distanceMetres!,
  })
}

const verifySiteAgainstGazetteer = async (site: ConcordanceSite): Promise<void> => {
  const candidate = await searchGazetteerByName(site.title)
  if (!candidate?.position) return

  const verdict = verifyEnrichmentMatch({
    site: { position: { lon: site.lon, lat: site.lat }, category: site.category },
    candidate: { position: candidate.position, placeTypes: candidate.placeTypes },
  })
  if (!verdict.accepted) return

  await recordConcordanceMatch({
    siteId: site.id,
    scheme: 'idai-gazetteer',
    value: candidate.gazId,
    distanceMetres: verdict.distanceMetres!,
  })
}

const verifySiteAgainstHistoricEngland = async (site: ConcordanceSite): Promise<void> => {
  if (site.countryCode !== 'GB') return

  const candidate = await searchHistoricEnglandNearby(
    { lon: site.lon, lat: site.lat },
    HISTORIC_ENGLAND_SEARCH_RADIUS_METRES,
  )
  if (!candidate) return

  const verdict = verifyEnrichmentMatch({
    site: { position: { lon: site.lon, lat: site.lat }, category: site.category },
    candidate: { position: candidate.position, placeTypes: [] },
  })
  if (!verdict.accepted) return

  await recordConcordanceMatch({
    siteId: site.id,
    scheme: 'historic-england',
    value: String(candidate.listEntry),
    distanceMetres: verdict.distanceMetres!,
  })
}

/**
 * Fire-and-forget from `applyRevision()` — the caller never awaits this. EDH
 * is a plain database join (fast, no network); iDAI.gazetteer and Historic
 * England each cost one external request with an 8s timeout, so this can
 * take a few seconds, which is exactly why nothing in the request path waits
 * on it. Each check already fails closed on its own (no candidate, or one
 * rejected by `verifyEnrichmentMatch`'s distance/category gate); the
 * try/catch here only stops a genuinely unreachable upstream from surfacing
 * as an unhandled rejection.
 */
export const verifySiteConcordances = async (siteId: number): Promise<void> => {
  const sql = useSql()
  const [site] = await sql<ConcordanceSite[]>`
    SELECT s.id, s.title, s.category, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
           s.country_code AS "countryCode",
           (SELECT value FROM external_ids WHERE site_id = s.id AND scheme = 'pleiades' LIMIT 1)
             AS "pleiadesId",
           (SELECT value FROM external_ids WHERE site_id = s.id AND scheme = 'trismegistos' LIMIT 1)
             AS "trismegistosId"
    FROM sites s
    WHERE s.id = ${siteId} AND s.status = 'approved'
  `
  if (!site) return

  try {
    await verifySiteAgainstEdh(site)
    await verifySiteAgainstGazetteer(site)
    await verifySiteAgainstHistoricEngland(site)
  } catch (error) {
    useLogger().warn(
      { siteId, error: (error as Error).message },
      'concordance verification failed for site',
    )
  }
}
