import type { LimesSector } from '#shared/types'

/**
 * The named sectors of the frontier, north-west to south-east.
 *
 * Ordered by the gazetteer rather than by length or name: the list is meant to
 * read as the frontier runs, so scrolling it traces the circuit from the Solway
 * to the Euphrates.
 */
defineRouteMeta({
  openAPI: {
    tags: ['limes'],
    summary: 'List the named frontier sectors',
    description: 'Ordered north-west to south-east, the way the frontier itself runs.',
  },
})

export default defineEventHandler(async (event): Promise<LimesSector[]> => {
  await enforceRateLimit(event, 'record')

  const sql = useSql()
  const rows = await sql<
    {
      id: number
      slug: string
      name: string
      latin_name: string | null
      summary: string | null
      pleiades_id: string | null
      min_year: number | null
      max_year: number | null
      length_metres: number
      west: number
      south: number
      east: number
      north: number
    }[]
  >`
    SELECT id, slug, name, latin_name, summary, pleiades_id, min_year, max_year, length_metres,
           ST_XMin(bbox) AS west, ST_YMin(bbox) AS south,
           ST_XMax(bbox) AS east, ST_YMax(bbox) AS north
    FROM limes_sectors
    ORDER BY id
  `

  setResponseHeader(event, 'cache-control', 'public, max-age=3600, stale-while-revalidate=86400')

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    latinName: row.latin_name,
    summary: row.summary,
    pleiadesId: row.pleiades_id,
    minYear: row.min_year,
    maxYear: row.max_year,
    lengthMetres: row.length_metres,
    bounds: { west: row.west, south: row.south, east: row.east, north: row.north },
  }))
})
