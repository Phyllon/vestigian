import { z } from 'zod'

export const paramsSchema = z.object({ id: routeIdentifier })

/**
 * Full record for one tracing, including its geometry so the edit tool can load
 * the existing shape rather than making the contributor redraw it.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tracings'],
    summary: 'Get a tracing by numeric id',
    description: 'Includes the full geometry, so the edit tool can load the existing shape.',
  },
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'record')
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const sql = useSql()

  const [row] = await sql<
    {
      id: number
      title: string
      kind: string
      category: string
      description: string | null
      geometry: string
      length_metres: number | null
      licence: string
      attribution: string | null
      updated_at: Date
    }[]
  >`
    SELECT id, title, kind::text AS kind, category::text AS category, description,
           ST_AsGeoJSON(geom) AS geometry,
           CASE WHEN kind = 'line'
                THEN ST_Length(geom::geography)
                ELSE NULL END AS length_metres,
           licence, attribution, updated_at
    FROM tracings
    WHERE id = ${id} AND status = 'approved'
    LIMIT 1
  `

  if (!row) {
    throw createError({ statusCode: 404, message: 'No approved tracing with that identifier.' })
  }

  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    category: row.category,
    description: row.description,
    geometry: JSON.parse(row.geometry),
    lengthMetres: row.length_metres,
    licence: row.licence,
    attribution: row.attribution,
    updatedAt: row.updated_at.toISOString(),
  }
})
