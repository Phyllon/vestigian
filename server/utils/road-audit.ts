import {
  ROAD_AUDIT_BUFFER_METRES,
  ROAD_AUDIT_GRADIENT_WINDOW_METRES,
  ROAD_AUDIT_STEEP_GRADIENT_PERCENT,
  compareForAuditList,
  isSteepStretch,
  isSupportedByFinds,
  type RankableRoadSegment,
  type RoadCertainty,
} from '#shared/utils/road-audit'

/**
 * The road audit as two CSV downloads — the evidence per segment, ranked so the
 * conjectured roads nothing stands beside come first, and the milestones far
 * from every road. Pure builders; the endpoints read the rows.
 *
 * CSV and not GeoJSON because the geometry is Itiner-e's own, 19 MB of it: a
 * centroid and the road's name and itinerary are enough to find a row on
 * Itiner-e's map or this one, and a reader who wants the lines has the source.
 */

export interface RoadAuditSegmentRow {
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
}

export interface RoadAuditGapRow {
  source: string
  sourceKey: string
  title: string
  longitude: number
  latitude: number
  nearestRoadMetres: number | null
}

/**
 * RFC 4180 quoting, plus a guard for spreadsheets: a field that begins with `=`,
 * `+`, `-` or `@` is read by Excel and its kin as a formula, and a title is
 * somebody else's text. It is prefixed with an apostrophe, which they display as
 * nothing.
 */
export const escapeCsvField = (value: string | number | boolean | null): string => {
  if (value === null) return ''
  const text = String(value)
  const guarded = /^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? `'${text}` : text
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

const toCsv = (
  header: readonly string[],
  rows: readonly (string | number | boolean | null)[][],
): string => [header, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n'

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** The leading `#` lines say what the numbers are; a reader meets them before the data. */
const SEGMENT_NOTE = [
  `# Evidence beside each conjectured or hypothetical Itiner-e road, within ${ROAD_AUDIT_BUFFER_METRES} m.`,
  "# Not a verdict: Itiner-e's own classification is unchanged, and a count of zero says only that nothing is recorded here.",
  `# steep = steepest ${ROAD_AUDIT_GRADIENT_WINDOW_METRES} m stretch at or above ${ROAD_AUDIT_STEEP_GRADIENT_PERCENT}% on the terrain model used.`,
  '# rank 1 = a conjectured road with nothing recorded beside it, steep first, longer first.',
  '# Sources: Itiner-e (CC BY 4.0), EDH (CC BY-SA 4.0), vici.org (CC BY-SA 3.0), terrain models.',
]

export const buildRoadAuditSegmentsCsv = (rows: readonly RoadAuditSegmentRow[]): string => {
  const ranked = rows
    .map((row) => {
      const ranking: RankableRoadSegment = {
        certainty: row.certainty,
        lengthMetres: row.lengthMetres,
        evidence: {
          edhMilestones: row.edhMilestones,
          viciMilestones: row.viciMilestones,
          viciRoadSites: row.viciRoadSites,
          certainEnds: row.certainEnds,
          steepestGradientPercent: row.steepestGradientPercent,
        },
      }
      return { row, ranking }
    })
    .sort((a, b) => compareForAuditList(a.ranking, b.ranking))

  const body = toCsv(
    [
      'rank',
      'road_id',
      'name',
      'certainty',
      'itinerary',
      'length_m',
      'longitude',
      'latitude',
      'edh_milestones',
      'vici_milestones',
      'vici_road_sites',
      'certain_ends',
      'steepest_gradient_percent',
      'terrain_coverage',
      'finds_nearby',
      'steep',
    ],
    ranked.map(({ row, ranking }, index) => [
      index + 1,
      row.roadId,
      row.name,
      row.certainty,
      row.itinerary,
      row.lengthMetres,
      roundTo(row.longitude, 5),
      roundTo(row.latitude, 5),
      row.edhMilestones,
      row.viciMilestones,
      row.viciRoadSites,
      row.certainEnds,
      row.steepestGradientPercent === null ? null : roundTo(row.steepestGradientPercent, 1),
      row.terrainCoverage === null ? null : roundTo(row.terrainCoverage, 2),
      isSupportedByFinds(ranking.evidence),
      isSteepStretch(ranking.evidence.steepestGradientPercent),
    ]),
  )
  return `${SEGMENT_NOTE.join('\r\n')}\r\n${body}`
}

const GAP_NOTE = [
  '# Located milestones with no Itiner-e road within 1 km (or none within about 5 km).',
  '# A findspot is often where a stone was carried or re-used, so a row is a question: a moved stone, a road the model lacks, or a misplaced coordinate.',
  '# Sources: EDH (CC BY-SA 4.0), vici.org (CC BY-SA 3.0), Itiner-e (CC BY 4.0).',
]

export const buildRoadAuditGapsCsv = (rows: readonly RoadAuditGapRow[]): string => {
  const ordered = [...rows].sort(
    (a, b) => (b.nearestRoadMetres ?? Infinity) - (a.nearestRoadMetres ?? Infinity),
  )
  const body = toCsv(
    ['source', 'source_key', 'title', 'longitude', 'latitude', 'nearest_road_m'],
    ordered.map((row) => [
      row.source,
      row.sourceKey,
      row.title,
      roundTo(row.longitude, 5),
      roundTo(row.latitude, 5),
      row.nearestRoadMetres,
    ]),
  )
  return `${GAP_NOTE.join('\r\n')}\r\n${body}`
}
