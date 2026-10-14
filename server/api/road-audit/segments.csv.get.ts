import { buildRoadAuditSegmentsCsv, type RoadAuditSegmentRow } from '~~/server/utils/road-audit'
import type { RoadCertainty } from '#shared/utils/road-audit'

/**
 * The evidence beside each conjectured or hypothetical Itiner-e road, ranked.
 * Written by `pnpm roads:audit`; empty until it has run. See
 * `.claude/rules/road-audit.md`.
 *
 * Not under `/api/data/`: that path is the project's CC BY-SA / CC0 reuse feed,
 * and this is derived from Itiner-e (CC BY 4.0), EDH (CC BY-SA 4.0) and vici.org
 * (CC BY-SA 3.0) together. No query string, so the CDN may cache it.
 */
defineRouteMeta({
  openAPI: {
    tags: ['road-audit'],
    summary: 'The road audit, per segment, as CSV',
    description:
      'Conjectured and hypothetical Itiner-e segments with the milestones and road records within 300 m, whether an end meets a surveyed segment, and the steepest 250 m stretch — ranked, never a verdict. Itiner-e CC BY 4.0, EDH CC BY-SA 4.0, vici.org CC BY-SA 3.0.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'search')
  const sql = useSql()

  const rows = await sql<
    {
      roadId: number
      name: string | null
      certainty: RoadCertainty
      itinerary: string | null
      lengthMetres: number
      longitude: number
      latitude: number
      edhMilestones: number
      viciMilestones: number
      viciRoadSites: number
      certainEnds: number
      steepestGradientPercent: number | null
      terrainCoverage: number | null
    }[]
  >`
    SELECT
      audit.road_id AS "roadId", road.name, road.certainty::text AS certainty, road.itinerary,
      audit.length_metres AS "lengthMetres",
      ST_X(ST_Centroid(road.geom)) AS longitude, ST_Y(ST_Centroid(road.geom)) AS latitude,
      audit.edh_milestones AS "edhMilestones", audit.vici_milestones AS "viciMilestones",
      audit.vici_road_sites AS "viciRoadSites", audit.certain_ends AS "certainEnds",
      audit.steepest_gradient_percent::float AS "steepestGradientPercent",
      audit.terrain_coverage::float AS "terrainCoverage"
    FROM road_audit_segments audit
    JOIN antiquity_roman_roads road ON road.id = audit.road_id
  `

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'content-disposition': 'attachment; filename="vestigian-road-audit-segments.csv"',
  })

  return buildRoadAuditSegmentsCsv(rows satisfies RoadAuditSegmentRow[])
})
