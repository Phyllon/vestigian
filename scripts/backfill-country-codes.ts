/**
 * Fills `sites.country_code` by point-in-polygon against `country_boundaries`
 * (Natural Earth, public domain — `scripts/import/07-country-boundaries.ts`,
 * which must run first).
 *
 * This is the backfill CLAUDE.md already named as owed. It went through two
 * earlier, wrong versions before this one, both worth knowing about:
 *
 * 1. First version matched each site to the nearest row in `geo_names` —
 *    but `geo_names` is a sparse point set scoped to wherever vici.org's
 *    own `geo.sql` dump happens to cover (five countries: DE, FR, IT, NL,
 *    BE). A site genuinely outside that area still has *some* nearest
 *    point, however far away, and an unguarded match confidently
 *    mislabelled it — caught by testing a real out-of-range coordinate
 *    (Madrid, which came back `FR`), and found to affect 32,032 of the
 *    then-61,273 sites once audited.
 * 2. Second version added a 75 km distance guard to the same `geo_names`
 *    lookup — correct as far as it went, but a nearest-*point* match is the
 *    wrong tool regardless of the guard: it can only ever answer for the
 *    five countries `geo_names` happens to contain, clearing everything
 *    else (43,479 sites, over two thirds) to null rather than answering
 *    them at all.
 *
 * Point-in-polygon against real national boundaries has neither problem for
 * almost every site — a coordinate is either inside a country or it is not,
 * for any country. The one real exception is the coastline itself: Natural
 * Earth's 1:50m boundary is a simplification, and a genuinely coastal site
 * (a harbour, a villa maritima, a small island) can land just outside it in
 * the gap — measured, 688 sites, mostly Italian coastal and island sites up
 * to 54 km from the nearest mapped boundary, against a 100+ km gap to the
 * next-nearest country in every one of them. `COASTAL_TOLERANCE_METRES`
 * covers that gap without reintroducing the earlier bug: 60 km is still a
 * fraction of the margin to a genuinely different country.
 *
 * A direct UPDATE, not a revision: this is a geographic fact derived from a
 * site's own recorded coordinates, not an editorial change to what a record
 * says, the same category as `strip-description-html.ts` and
 * `reconcile-images.ts`.
 *
 *   pnpm exec tsx scripts/backfill-country-codes.ts           report only
 *   pnpm exec tsx scripts/backfill-country-codes.ts --repair  also write it
 */
import postgres from 'postgres'

const shouldRepair = process.argv.includes('--repair')

const sql = postgres(
  process.env.NUXT_DATABASE_URL ?? 'postgres://vestigian:vestigian@127.0.0.1:5432/vestigian',
)

interface CandidateRow {
  id: number
  currentCountry: string | null
  resolvedCountry: string | null
}

const COASTAL_TOLERANCE_METRES = 60_000

const main = async (): Promise<void> => {
  const [boundaries] = await sql<{ count: string }[]>`
    SELECT count(*)::text FROM country_boundaries
  `

  if ((boundaries?.count ?? '0') === '0') {
    console.error('country_boundaries is empty. Run `pnpm import:country-boundaries` first.')
    process.exitCode = 1
    return
  }

  const rows = await sql<CandidateRow[]>`
    SELECT s.id, s.country_code AS "currentCountry",
           COALESCE(
             (SELECT b.iso_a2 FROM country_boundaries b WHERE ST_Contains(b.geom, s.geom) LIMIT 1),
             (
               SELECT n.iso_a2 FROM (
                 SELECT iso_a2, geom FROM country_boundaries ORDER BY geom <-> s.geom LIMIT 1
               ) n
               WHERE ST_DWithin(n.geom::geography, s.geom::geography, ${COASTAL_TOLERANCE_METRES})
             )
           ) AS "resolvedCountry"
    FROM sites s
    WHERE s.status = 'approved'
  `

  const changes = rows.filter((row) => row.resolvedCountry !== row.currentCountry)
  const filled = changes.filter((row) => row.currentCountry === null).length
  const corrected = changes.filter(
    (row) => row.currentCountry !== null && row.resolvedCountry !== null,
  ).length
  const clearedNoMatch = changes.filter(
    (row) => row.currentCountry !== null && row.resolvedCountry === null,
  ).length

  console.log(`${rows.length} approved sites checked.`)
  console.log(`  · ${filled} newly filled`)
  console.log(`  · ${corrected} corrected (had a country_code, now resolves differently)`)
  console.log(
    `  · ${clearedNoMatch} cleared to null (not inside any known boundary — likely open water)`,
  )
  console.log(`  · ${rows.length - changes.length} already correct, unchanged`)

  if (shouldRepair && changes.length > 0) {
    const BATCH_SIZE = 1000
    for (let offset = 0; offset < changes.length; offset += BATCH_SIZE) {
      const batch = changes.slice(offset, offset + BATCH_SIZE)
      await sql`
        UPDATE sites SET country_code = v.country_code
        FROM unnest(
          ${batch.map((row) => row.id)}::integer[],
          ${batch.map((row) => row.resolvedCountry)}::text[]
        ) AS v(id, country_code)
        WHERE sites.id = v.id
      `
    }
    console.log(`\n${changes.length} rows written.`)
  } else if (changes.length > 0) {
    console.log('\nRun again with --repair to write these.')
  }

  await sql.end()
}

await main()
