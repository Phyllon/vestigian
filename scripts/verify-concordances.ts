/**
 * Discovers and verifies cross-references to EDH, iDAI.gazetteer and
 * Historic England, writing a matched identifier into `external_ids` and
 * its check into `external_id_verifications` — one row per (identifier,
 * source) pair, so the same Wikidata id verified against Wikidata and
 * against iDAI.gazetteer keeps two independent results.
 *
 * Unlike the Wikidata/Pleiades/DARE resolution ladder
 * (`enrichment-sources.ts`), none of these three sources correspond to a
 * concordance scheme vici.org's own import ever captured — there is no
 * existing `edh=…`/`idai-gazetteer=…`/`historic-england=…` row to verify.
 * This script *discovers* the match and records it as already verified in
 * one step, because for these three there is no unverified claim to check
 * against later: a candidate either passes `verifyEnrichmentMatch` right
 * now or nothing is written at all.
 *
 * Three different lookup shapes:
 *
 *   EDH               A pure database join, no network call. A site with a
 *                      `pleiades` or `trismegistos` external id joins
 *                      directly to `edh_findspots` by that same identifier
 *                      (imported in bulk — `scripts/import/08-edh-findspots.ts`)
 *                      — fast enough to run over every approved site.
 *   iDAI.gazetteer     A live search by the site's own title — there is
 *                      nothing to join by. This is the expensive one: no
 *                      documented rate limit was found, so `REQUEST_DELAY_MS`
 *                      paces it conservatively. A full run over every
 *                      approved site is an overnight-scale operation, the
 *                      same category as `pnpm import:images` — use `LIMIT`
 *                      to test against a slice first.
 *   Historic England   A live geometry search, called only for sites
 *                      already resolved to `GB` (`sites.country_code`) —
 *                      1,534 of them, not 61,273, because asking a national
 *                      register about a site nowhere near it would be
 *                      exactly the unscoped-call problem this project has
 *                      avoided everywhere else.
 *
 * Resumable: a site already carrying a verification row for a given source
 * is skipped, so an interrupted run costs nothing to restart.
 *
 *   pnpm exec tsx scripts/verify-concordances.ts                  report only
 *   pnpm exec tsx scripts/verify-concordances.ts --repair          also write
 *   LIMIT=200 pnpm exec tsx scripts/verify-concordances.ts --repair   a slice
 */
import postgres from 'postgres'
import type { LonLat, SiteCategory } from '../shared/types'
import { verifyEnrichmentMatch } from '../server/utils/enrichment'
import {
  searchGazetteerByName,
  searchHistoricEnglandNearby,
} from '../server/utils/concordance-sources'

const shouldRepair = process.argv.includes('--repair')
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined
const REQUEST_DELAY_MS = 400
/** Generous — the point is finding a candidate to hand to the real distance/category gate, not pre-filtering. */
const HISTORIC_ENGLAND_SEARCH_RADIUS_METRES = 500

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface SiteRow {
  id: number
  title: string
  category: SiteCategory
  lon: number
  lat: number
  countryCode: string | null
  pleiadesId: string | null
  trismegistosId: string | null
}

interface MatchOutcome {
  siteId: number
  scheme: string
  value: string
  distanceMetres: number
}

/**
 * Writes the identifier and its verification together — `ON CONFLICT …
 * RETURNING id` rather than `DO NOTHING`, because a plain insert-or-skip
 * would never hand back the id of an already-existing row for the
 * verification insert that follows.
 */
const recordMatch = async (outcome: MatchOutcome): Promise<void> => {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO external_ids (site_id, scheme, value)
    VALUES (${outcome.siteId}, ${outcome.scheme}, ${outcome.value})
    ON CONFLICT (site_id, scheme, value) DO UPDATE SET value = EXCLUDED.value
    RETURNING id
  `

  await sql`
    INSERT INTO external_id_verifications (external_id_id, status, distance_metres, checked_via)
    VALUES (${row!.id}, 'verified', ${Math.round(outcome.distanceMetres)}, ${outcome.scheme})
    ON CONFLICT (external_id_id, checked_via)
    DO UPDATE SET status = 'verified', distance_metres = EXCLUDED.distance_metres, checked_at = now()
  `
}

const alreadyChecked = async (scheme: string): Promise<Set<number>> => {
  const rows = await sql<{ siteId: number }[]>`
    SELECT DISTINCT e.site_id AS "siteId"
    FROM external_id_verifications v
    JOIN external_ids e ON e.id = v.external_id_id
    WHERE v.checked_via = ${scheme}
  `
  return new Set(rows.map((row) => row.siteId))
}

const verifyAgainstEdh = async (sites: SiteRow[]): Promise<MatchOutcome[]> => {
  const checked = await alreadyChecked('edh')
  const candidates = sites.filter(
    (site) => !checked.has(site.id) && (site.pleiadesId || site.trismegistosId),
  )

  if (candidates.length === 0) return []

  const pleiadesIds = candidates.map((site) => site.pleiadesId).filter((id) => id !== null)
  const trismegistosIds = candidates.map((site) => site.trismegistosId).filter((id) => id !== null)

  const findspots = await sql<
    {
      edhUri: string
      pleiadesId: string | null
      trismegistosId: string | null
      lon: number
      lat: number
    }[]
  >`
    SELECT edh_uri AS "edhUri", pleiades_id AS "pleiadesId", trismegistos_id AS "trismegistosId",
           ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM edh_findspots
    WHERE pleiades_id = ANY(${pleiadesIds}) OR trismegistos_id = ANY(${trismegistosIds})
  `

  const byPleiadesId = new Map(findspots.filter((f) => f.pleiadesId).map((f) => [f.pleiadesId, f]))
  const byTrismegistosId = new Map(
    findspots.filter((f) => f.trismegistosId).map((f) => [f.trismegistosId, f]),
  )

  const outcomes: MatchOutcome[] = []

  for (const site of candidates) {
    const findspot =
      (site.pleiadesId && byPleiadesId.get(site.pleiadesId)) ||
      (site.trismegistosId && byTrismegistosId.get(site.trismegistosId))
    if (!findspot) continue

    const verdict = verifyEnrichmentMatch({
      site: { position: { lon: site.lon, lat: site.lat }, category: site.category },
      candidate: { position: { lon: findspot.lon, lat: findspot.lat }, placeTypes: [] },
    })

    if (verdict.accepted) {
      const edhId = /\/(\d+)\/?$/.exec(findspot.edhUri)?.[1] ?? findspot.edhUri
      outcomes.push({
        siteId: site.id,
        scheme: 'edh',
        value: edhId,
        distanceMetres: verdict.distanceMetres!,
      })
    }
  }

  return outcomes
}

const verifyAgainstGazetteer = async (sites: SiteRow[]): Promise<MatchOutcome[]> => {
  const checked = await alreadyChecked('idai-gazetteer')
  const candidates = sites.filter((site) => !checked.has(site.id))
  const outcomes: MatchOutcome[] = []

  for (const [index, site] of candidates.entries()) {
    const candidate = await searchGazetteerByName(site.title)
    if (candidate?.position) {
      const verdict = verifyEnrichmentMatch({
        site: { position: { lon: site.lon, lat: site.lat }, category: site.category },
        candidate: { position: candidate.position, placeTypes: candidate.placeTypes },
      })
      if (verdict.accepted) {
        outcomes.push({
          siteId: site.id,
          scheme: 'idai-gazetteer',
          value: candidate.gazId,
          distanceMetres: verdict.distanceMetres!,
        })
      }
    }

    if ((index + 1) % 100 === 0) {
      console.log(`  · iDAI.gazetteer ${index + 1}/${candidates.length}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }

  return outcomes
}

const verifyAgainstHistoricEngland = async (sites: SiteRow[]): Promise<MatchOutcome[]> => {
  const checked = await alreadyChecked('historic-england')
  const candidates = sites.filter((site) => !checked.has(site.id) && site.countryCode === 'GB')
  const outcomes: MatchOutcome[] = []

  for (const [index, site] of candidates.entries()) {
    const position: LonLat = { lon: site.lon, lat: site.lat }
    const candidate = await searchHistoricEnglandNearby(
      position,
      HISTORIC_ENGLAND_SEARCH_RADIUS_METRES,
    )
    if (candidate) {
      const verdict = verifyEnrichmentMatch({
        site: { position, category: site.category },
        candidate: { position: candidate.position, placeTypes: [] },
      })
      if (verdict.accepted) {
        outcomes.push({
          siteId: site.id,
          scheme: 'historic-england',
          value: String(candidate.listEntry),
          distanceMetres: verdict.distanceMetres!,
        })
      }
    }

    if ((index + 1) % 100 === 0) {
      console.log(`  · Historic England ${index + 1}/${candidates.length}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }

  return outcomes
}

const main = async (): Promise<void> => {
  const sites = await sql<SiteRow[]>`
    SELECT s.id, s.title, s.category, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
           s.country_code AS "countryCode",
           (SELECT value FROM external_ids WHERE site_id = s.id AND scheme = 'pleiades' LIMIT 1)
             AS "pleiadesId",
           (SELECT value FROM external_ids WHERE site_id = s.id AND scheme = 'trismegistos' LIMIT 1)
             AS "trismegistosId"
    FROM sites s
    WHERE s.status = 'approved'
    ORDER BY s.id
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
  `

  console.log(`${sites.length} approved sites in scope.\n`)

  console.log('EDH (database join, no network)…')
  const edhMatches = await verifyAgainstEdh(sites)
  console.log(`  ${edhMatches.length} verified matches.\n`)

  console.log('iDAI.gazetteer (live search)…')
  const gazetteerMatches = await verifyAgainstGazetteer(sites)
  console.log(`  ${gazetteerMatches.length} verified matches.\n`)

  console.log('Historic England (live search, GB sites only)…')
  const historicEnglandMatches = await verifyAgainstHistoricEngland(sites)
  console.log(`  ${historicEnglandMatches.length} verified matches.\n`)

  const all = [...edhMatches, ...gazetteerMatches, ...historicEnglandMatches]

  if (shouldRepair) {
    for (const outcome of all) {
      await recordMatch(outcome)
    }
    console.log(`${all.length} matches written.`)
  } else if (all.length > 0) {
    console.log(`${all.length} matches found. Run again with --repair to write them.`)
  }

  await sql.end()
}

await main()
