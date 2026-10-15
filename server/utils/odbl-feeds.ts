import { z } from 'zod'
import type postgres from 'postgres'
import {
  antiquityFeatureKindEnum,
  antiquityLineKindEnum,
  antiquityWaterKindEnum,
  limesSegmentKindEnum,
} from '~~/server/database/schema'
import {
  LIMES_SOURCE_LICENCE,
  ODBL_FEED_META,
  type OdblFeedFormat,
  type OdblFeedLayer,
} from '#shared/utils/odbl-feeds'
import { licenceLabel, licenceUri } from '#shared/utils/licence-uris'
import {
  SURVEY_PROJECT,
  SURVEY_SITE_KINDS,
  SURVEY_SITE_SOURCES,
  SURVEY_SITE_SOURCE_META,
} from '#shared/utils/survey-sites'
import type { LimesSource } from '#shared/types'
import type { RdfDataset, RdfExtraValue, RdfFeature } from './rdf'
import { buildSurveySiteFeatureCollection, type SurveySiteFeedRow } from './survey-sites-feed'

/**
 * The ODbL reuse feeds: one reader per layer behind `/api/odbl/:layer.:format`.
 * What exists, and why, is `shared/utils/odbl-feeds.ts`; this file is only the
 * queries and the two serialisations of what they return.
 */

export const odblFeedQuerySchema = z.object({
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/, 'bbox must be west,south,east,north')
    .optional(),
  kind: z.string().min(1).max(40).optional(),
  source: z.string().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /**
   * Rows skipped, in a stable order — advance by `limit` until a page comes back short.
   * The serial ids these tables key on are reassigned by every import, so a walk
   * that straddles a re-import can repeat or skip a row; nothing else is stable.
   */
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
})

export type OdblFeedQuery = z.infer<typeof odblFeedQuerySchema>

const LIMES_SOURCES: readonly LimesSource[] = ['osm', 'ohm', 'vici', 'awmc', 'extent']

/** The values each filter accepts, per layer. A layer with no entry has no such filter. */
const ALLOWED_FILTERS: Readonly<
  Partial<Record<OdblFeedLayer, { kind?: readonly string[]; source?: readonly string[] }>>
> = {
  'awmc-water': { kind: antiquityWaterKindEnum.enumValues },
  'awmc-lines': { kind: antiquityLineKindEnum.enumValues },
  // `antiquity_areas.kind` is a plain varchar; these are the two the importers write.
  'awmc-areas': { kind: ['urban', 'centuriation'] },
  'awmc-features': { kind: antiquityFeatureKindEnum.enumValues },
  limes: { kind: limesSegmentKindEnum.enumValues, source: LIMES_SOURCES },
  'survey-sites': { kind: SURVEY_SITE_KINDS, source: SURVEY_SITE_SOURCES },
}

export interface OdblResolvedQuery {
  bbox?: string
  kind?: string
  source?: string
  limit: number
  offset: number
}

/**
 * Resolves the page the request asked for, or refuses it with 400.
 *
 * An unknown `kind` used to be the one way to turn a reuse feed into a 500 (the
 * enum cast), and a `limit` beyond what a layer's geometry can carry is refused
 * rather than clamped — see `OdblFeedMeta.maxLimit`.
 */
export const resolveOdblFeedQuery = (
  layer: OdblFeedLayer,
  query: OdblFeedQuery,
): OdblResolvedQuery => {
  const meta = ODBL_FEED_META[layer]
  const limit = query.limit ?? meta.defaultLimit

  if (limit > meta.maxLimit) {
    throw createError({
      statusCode: 400,
      message: `limit for ${layer} is at most ${meta.maxLimit}`,
    })
  }

  for (const filter of ['kind', 'source'] as const) {
    const value = query[filter]
    if (value === undefined) continue

    const allowed = ALLOWED_FILTERS[layer]?.[filter]
    if (!allowed) {
      throw createError({ statusCode: 400, message: `${layer} has no ${filter} filter` })
    }
    if (!allowed.includes(value)) {
      throw createError({
        statusCode: 400,
        message: `${filter} must be one of ${allowed.join(', ')}`,
      })
    }
  }

  return { bbox: query.bbox, kind: query.kind, source: query.source, limit, offset: query.offset }
}

/** One feature, in the shape both serialisations are built from. */
export interface OdblFeedRow {
  /** A key the source itself guarantees. Serial ids are not one — they are reassigned on import. */
  key: string | null
  name: string | null
  kind: string | null
  period: { from: number | null; to: number | null } | null
  source: { key: string; name: string; url: string | null; licence: string } | null
  /** Set only where the licence differs from the collection's. */
  licence: string | null
  properties: Record<string, RdfExtraValue>
  /** GeoJSON, when the request is for GeoJSON; `wkt` when it is for Turtle. */
  geometry?: unknown
  wkt?: string
}

export type OdblFeedPage =
  | { layer: 'survey-sites'; rows: SurveySiteFeedRow[] }
  | { layer: Exclude<OdblFeedLayer, 'survey-sites'>; rows: OdblFeedRow[] }

const envelope = (bbox: string | undefined): [number, number, number, number] => {
  const [west, south, east, north] = bbox ? bbox.split(',').map(Number) : [-180, -85, 180, 85]
  return [west!, south!, east!, north!]
}

const geometryColumn = (sql: postgres.Sql, column: string, format: OdblFeedFormat) =>
  format === 'geojson'
    ? sql`ST_AsGeoJSON(${sql(column)}, 6)::jsonb AS geometry`
    : sql`ST_AsText(${sql(column)}, 6) AS wkt`

const withinBbox = (sql: postgres.Sql, column: string, bbox: string | undefined) => {
  const [west, south, east, north] = envelope(bbox)
  return sql`${sql(column)} && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)`
}

interface GeometryRow {
  geometry?: unknown
  wkt?: string
}

const LIMES_SOURCE_META: Readonly<Record<LimesSource, { name: string; url: string }>> = {
  osm: { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ohm: {
    name: 'OpenHistoricalMap contributors',
    url: 'https://www.openhistoricalmap.org/copyright',
  },
  vici: { name: 'vici.org contributors', url: 'https://vici.org' },
  awmc: { name: 'Ancient World Mapping Center', url: 'https://github.com/AWMC/geodata' },
  extent: {
    name: 'Ancient World Mapping Center (generalised empire extent)',
    url: 'https://github.com/AWMC/geodata',
  },
}

const fetchSurveySites = async (
  sql: postgres.Sql,
  query: OdblResolvedQuery,
): Promise<SurveySiteFeedRow[]> => {
  const { bbox, kind, source, limit, offset } = query
  return sql<SurveySiteFeedRow[]>`
    SELECT survey_id, name, source, kind, period_keys, period_from, period_to, period_basis,
           destroyed, uncertain, evidence, ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM antiquity_survey_sites
    WHERE ${withinBbox(sql, 'geom', bbox)}
      ${kind ? sql`AND kind = ${kind}` : sql``}
      ${source ? sql`AND source = ${source}` : sql``}
    ORDER BY survey_id
    LIMIT ${limit} OFFSET ${offset}
  `
}

const fetchLimes = async (
  sql: postgres.Sql,
  query: OdblResolvedQuery,
  format: OdblFeedFormat,
): Promise<OdblFeedRow[]> => {
  const { bbox, kind, source, limit, offset } = query
  const rows = await sql<
    (GeometryRow & {
      kind: string
      certain: boolean
      source: LimesSource
      sector_slug: string
      sector_name: string
    })[]
  >`
    SELECT limes_segments.kind::text AS kind, limes_segments.certain, limes_segments.source,
           limes_sectors.slug AS sector_slug, limes_sectors.name AS sector_name,
           ${geometryColumn(sql, 'limes_segments.geom', format)}
    FROM limes_segments
    JOIN limes_sectors ON limes_sectors.id = limes_segments.sector_id
    WHERE ${withinBbox(sql, 'limes_segments.geom', bbox)}
      ${kind ? sql`AND limes_segments.kind = ${kind}::limes_segment_kind` : sql``}
      ${source ? sql`AND limes_segments.source = ${source}` : sql``}
    ORDER BY limes_segments.id
    LIMIT ${limit} OFFSET ${offset}
  `

  return rows.map((row) => {
    const meta = LIMES_SOURCE_META[row.source]
    return {
      key: null,
      name: row.sector_name,
      kind: row.kind,
      period: null,
      source: {
        key: row.source,
        name: meta?.name ?? row.source,
        url: meta?.url ?? null,
        licence: LIMES_SOURCE_LICENCE[row.source] ?? 'unknown',
      },
      licence: null,
      properties: { sector: row.sector_slug, certain: row.certain },
      geometry: row.geometry,
      wkt: row.wkt,
    }
  })
}

/**
 * The layers whose rows are a table of their own, differing only in columns.
 * `name` and `kind` map to the feature's label and type; every other column
 * rides in `properties`, as it does in the GeoJSON and as a schema.org
 * `PropertyValue` in the Turtle.
 */
interface SimpleLayer {
  run: (
    sql: postgres.Sql,
    query: OdblResolvedQuery,
    format: OdblFeedFormat,
  ) => Promise<OdblFeedRow[]>
}

const simpleRow = (
  row: GeometryRow,
  fields: Pick<OdblFeedRow, 'name' | 'kind' | 'period' | 'properties'>,
): OdblFeedRow => ({
  key: null,
  source: null,
  licence: null,
  ...fields,
  geometry: row.geometry,
  wkt: row.wkt,
})

const SIMPLE_LAYERS: Readonly<Partial<Record<OdblFeedLayer, SimpleLayer>>> = {
  'awmc-water': {
    run: async (sql, query, format) => {
      const { bbox, kind, limit, offset } = query
      const rows = await sql<(GeometryRow & { kind: string; name: string | null })[]>`
        SELECT kind::text AS kind, name, ${geometryColumn(sql, 'geom', format)}
        FROM antiquity_water
        WHERE ${withinBbox(sql, 'geom', bbox)}
          ${kind ? sql`AND kind = ${kind}::antiquity_water_kind` : sql``}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `
      return rows.map((row) =>
        simpleRow(row, { name: row.name, kind: row.kind, period: null, properties: {} }),
      )
    },
  },
  'awmc-lines': {
    run: async (sql, query, format) => {
      const { bbox, kind, limit, offset } = query
      const rows = await sql<
        (GeometryRow & {
          kind: string
          name: string | null
          major: boolean
          certain: boolean
          period: string | null
        })[]
      >`
        SELECT kind::text AS kind, name, major, certain, period,
               ${geometryColumn(sql, 'geom', format)}
        FROM antiquity_lines
        WHERE ${withinBbox(sql, 'geom', bbox)}
          ${kind ? sql`AND kind = ${kind}::antiquity_line_kind` : sql``}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `
      return rows.map((row) =>
        simpleRow(row, {
          name: row.name,
          kind: row.kind,
          period: null,
          properties: { major: row.major, certain: row.certain, period: row.period },
        }),
      )
    },
  },
  'awmc-areas': {
    run: async (sql, query, format) => {
      const { bbox, kind, limit, offset } = query
      const rows = await sql<
        (GeometryRow & { kind: string; name: string | null; pleiades_id: string | null })[]
      >`
        SELECT kind, name, pleiades_id, ${geometryColumn(sql, 'geom', format)}
        FROM antiquity_areas
        WHERE ${withinBbox(sql, 'geom', bbox)}
          ${kind ? sql`AND kind = ${kind}` : sql``}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `
      return rows.map((row) =>
        simpleRow(row, {
          name: row.name,
          kind: row.kind,
          period: null,
          properties: { pleiadesId: row.pleiades_id },
        }),
      )
    },
  },
  'awmc-regions': {
    run: async (sql, query, format) => {
      const { bbox, limit, offset } = query
      const rows = await sql<
        (GeometryRow & {
          title: string
          kind: string | null
          pleiades_id: string | null
          min_year: number | null
          max_year: number | null
        })[]
      >`
        SELECT title, kind, pleiades_id, min_year, max_year,
               ${geometryColumn(sql, 'geom', format)}
        FROM antiquity_regions
        WHERE ${withinBbox(sql, 'geom', bbox)}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `
      return rows.map((row) =>
        simpleRow(row, {
          name: row.title,
          kind: row.kind,
          period: { from: row.min_year, to: row.max_year },
          properties: { pleiadesId: row.pleiades_id },
        }),
      )
    },
  },
  'awmc-features': {
    run: async (sql, query, format) => {
      const { bbox, kind, limit, offset } = query
      const rows = await sql<
        (GeometryRow & {
          kind: string
          name: string | null
          source: string | null
          material: string | null
          periods: string | null
        })[]
      >`
        SELECT kind::text AS kind, name, source, material, periods,
               ${geometryColumn(sql, 'geom', format)}
        FROM antiquity_features
        WHERE ${withinBbox(sql, 'geom', bbox)}
          ${kind ? sql`AND kind = ${kind}::antiquity_feature_kind` : sql``}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `
      return rows.map((row) =>
        simpleRow(row, {
          name: row.name,
          kind: row.kind,
          period: null,
          properties: { sheet: row.source, material: row.material, periods: row.periods },
        }),
      )
    },
  },
  'coin-hoards': {
    run: async (sql, query, format) => {
      const { bbox, limit, offset } = query
      const rows = await sql<
        (GeometryRow & { name: string; hoard_count: number; geonames_url: string | null })[]
      >`
        SELECT name, hoard_count, geonames_url, ${geometryColumn(sql, 'geom', format)}
        FROM antiquity_coin_hoards
        WHERE ${withinBbox(sql, 'geom', bbox)}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `
      return rows.map((row) =>
        simpleRow(row, {
          name: row.name,
          kind: 'coin-hoard-findspot',
          period: null,
          properties: { hoardCount: row.hoard_count, geonamesUrl: row.geonames_url },
        }),
      )
    },
  },
}

export interface OdblFeedRequest {
  sql: postgres.Sql
  layer: OdblFeedLayer
  query: OdblResolvedQuery
  format: OdblFeedFormat
}

export const fetchOdblFeedPage = async (request: OdblFeedRequest): Promise<OdblFeedPage> => {
  const { sql, layer, query, format } = request

  if (layer === 'survey-sites') {
    return { layer, rows: await fetchSurveySites(sql, query) }
  }
  if (layer === 'limes') {
    return { layer, rows: await fetchLimes(sql, query, format) }
  }

  const simple = SIMPLE_LAYERS[layer]
  if (!simple) throw createError({ statusCode: 404, message: 'No such feed' })
  return { layer, rows: await simple.run(sql, query, format) }
}

/**
 * GeoJSON: a collection that says what it is, under which licence and with what
 * credit and alterations — ODbL §4.6(b) wants the alterations on record, and a
 * downstream user who keeps only the file keeps the terms with it.
 */
export const buildOdblGeoJson = (page: OdblFeedPage): Record<string, unknown> => {
  if (page.layer === 'survey-sites') return buildSurveySiteFeatureCollection(page.rows)

  const meta = ODBL_FEED_META[page.layer]
  return {
    type: 'FeatureCollection',
    layer: page.layer,
    title: meta.title,
    licence: meta.licences.map((code) => licenceLabel(code)).join(' + '),
    licenceUrls: meta.licences.map((code) => licenceUri(code)).filter((url) => url !== null),
    attribution: meta.credit,
    alterations: meta.alterations,
    features: page.rows.map((row) => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        name: row.name,
        kind: row.kind,
        ...(row.period ? { periodFrom: row.period.from, periodTo: row.period.to } : {}),
        ...(row.source
          ? {
              source: row.source.key,
              sourceName: row.source.name,
              sourceUrl: row.source.url,
              sourceLicence: row.source.licence,
            }
          : {}),
        ...row.properties,
      },
    })),
  }
}

const surveyRdfFeature = (row: SurveySiteFeedRow, feedIri: string): RdfFeature => {
  const source = SURVEY_SITE_SOURCE_META[row.source]
  return {
    iri: `${feedIri}#${row.survey_id}`,
    label: row.name,
    kind: row.kind,
    description: null,
    featureClass: 'S',
    period: { from: row.period_from, to: row.period_to },
    wkt: `POINT(${row.lon} ${row.lat})`,
    licence: source?.licence ?? null,
    attribution: null,
    source: source ? { name: source.name, url: source.url } : null,
    links: [],
    extra: {
      periodBasis: row.period_basis,
      destroyed: row.destroyed,
      uncertain: row.uncertain,
      evidence: row.evidence,
    },
  }
}

export const buildOdblDataset = (page: OdblFeedPage, siteUrl: string): RdfDataset => {
  const iri = `${siteUrl.replace(/\/$/, '')}/api/odbl/${page.layer}.ttl`
  const meta = ODBL_FEED_META[page.layer]

  const features: RdfFeature[] =
    page.layer === 'survey-sites'
      ? page.rows.map((row) => surveyRdfFeature(row, iri))
      : page.rows.map((row) => ({
          iri: row.key ? `${iri}#${row.key}` : null,
          label: row.name,
          kind: row.kind,
          description: null,
          featureClass: null,
          period: row.period,
          wkt: row.wkt ?? '',
          licence: row.source?.licence ?? row.licence,
          attribution: null,
          source: row.source ? { name: row.source.name, url: row.source.url } : null,
          links: [],
          extra: row.properties,
        }))

  return {
    iri,
    title: meta.title,
    credit: meta.credit,
    licences: meta.licences,
    rights:
      page.layer === 'survey-sites'
        ? `Each feature names the upstream source and licence it came through; the collection is ${SURVEY_PROJECT.licence}.`
        : null,
    alterations: meta.alterations,
    features,
  }
}
