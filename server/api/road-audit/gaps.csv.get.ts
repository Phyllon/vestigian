import { buildRoadAuditGapsCsv, type RoadAuditGapRow } from '~~/server/utils/road-audit'

/**
 * Located milestones with no Itiner-e road within a kilometre — the other half of
 * the road audit. See `segments.csv.get.ts` for the licence and the path.
 */
defineRouteMeta({
  openAPI: {
    tags: ['road-audit'],
    summary: 'Milestones far from every known road, as CSV',
    description:
      'EDH and vici.org milestones with no Itiner-e road within 1 km, farthest first. A row is a question — a moved stone, a missing road or a misplaced coordinate — not a finding.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const sql = useSql()

  const rows = await sql<RoadAuditGapRow[]>`
    SELECT
      source, source_key AS "sourceKey", title,
      ST_X(geom) AS longitude, ST_Y(geom) AS latitude,
      nearest_road_metres AS "nearestRoadMetres"
    FROM road_audit_gaps
  `

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'content-disposition': 'attachment; filename="vestigian-road-audit-gaps.csv"',
  })

  return buildRoadAuditGapsCsv(rows)
})
