import {
  SURVEY_PROJECT,
  SURVEY_SITE_SOURCE_META,
  type SurveySiteSource,
} from '#shared/utils/survey-sites'

export interface SurveySiteFeedRow {
  survey_id: string
  name: string
  source: SurveySiteSource
  kind: string
  period_keys: string[]
  period_from: number
  period_to: number
  period_basis: string
  destroyed: boolean
  uncertain: boolean
  evidence: string | null
  lon: number
  lat: number
}

/**
 * The credit that travels with the collection. The Survey asks its users to credit its sources
 * and to share any adapted database under the same licence (ODbL 1.0); this feed is that sharing,
 * which is also why it is not folded into `/api/data/sites.geojson`, a CC BY-SA / CC0 feed.
 */
export const SURVEY_FEED_ATTRIBUTION = `Selected from the ${SURVEY_PROJECT.name} (${SURVEY_PROJECT.author}), ${SURVEY_PROJECT.url}. Each feature names the upstream source and licence it came through.`

/**
 * Every feature carries its own source, source licence and a link, because the collection's
 * licence (ODbL, share-alike) is not the only term on a row: the upstream's attribution
 * obligation rides with it. `id` is the Survey's own `MS-…` number, the stable key — this
 * table's serial ids are reassigned on every re-import.
 */
export const buildSurveySiteFeatureCollection = (
  rows: readonly SurveySiteFeedRow[],
): Record<string, unknown> => ({
  type: 'FeatureCollection',
  licence: SURVEY_PROJECT.licence,
  attribution: SURVEY_FEED_ATTRIBUTION,
  survey: { name: SURVEY_PROJECT.name, author: SURVEY_PROJECT.author, url: SURVEY_PROJECT.url },
  features: rows.map((row) => {
    const source = SURVEY_SITE_SOURCE_META[row.source]
    return {
      type: 'Feature',
      id: row.survey_id,
      geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: {
        name: row.name,
        kind: row.kind,
        periods: row.period_keys,
        periodFrom: row.period_from,
        periodTo: row.period_to,
        periodBasis: row.period_basis,
        destroyed: row.destroyed,
        uncertain: row.uncertain,
        evidence: row.evidence,
        source: row.source,
        sourceName: source?.name ?? null,
        sourceUrl: source?.url ?? null,
        sourceLicence: source?.licence ?? null,
        licence: SURVEY_PROJECT.licence,
      },
    }
  }),
})
