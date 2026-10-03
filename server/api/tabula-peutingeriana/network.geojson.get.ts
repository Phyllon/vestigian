/**
 * The Tabula Peutingeriana's places and roads, reconstructed to real
 * coordinates — for the optional map overlay, not the manuscript viewer at
 * `/tabula-peutingeriana` (an unrelated feature; see that page's own
 * docstring).
 *
 * **404s when `NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED` is `false`** — on by
 * default. The imported data (`pnpm import:tabula-peutingeriana`) carries no
 * stated licence of its own, so the basis for serving it is René Voorburg's
 * (the compiler's) confirmation that reuse is fine; the switch stays as the
 * way to withdraw it. See `.claude/rules/tabula-peutingeriana.md`.
 *
 * Not under `/api/data/` and not CORS-open, unlike `sites.geojson` — that
 * path is this project's documented CC BY-SA/CC0 reuse feed, and advertising
 * an unlicensed dataset alongside it would undersell exactly the distinction
 * this gate exists to protect. This is same-origin, for this app's own map
 * overlay only.
 *
 * The whole network in one response, not tiled or paged: 2,574 places and
 * 2,397 roads is a few hundred KB of GeoJSON, the same "small enough for one
 * response" reasoning that keeps the field notebook off the MVT pipeline
 * (see `server/api/me/map.geojson.get.ts`) — and unlike the notebook, this
 * is the same for every visitor and changes only when the import is re-run,
 * so it is safe to cache at the HTTP layer rather than per-request.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tabula-peutingeriana'],
    summary: 'The Tabula Peutingeriana network as GeoJSON, when enabled',
    description:
      'On by default; 404s when NUXT_PUBLIC_TABULA_PEUTINGERIANA_ENABLED=false. Reuse confirmed by the compiler, René Voorburg (omnesviae.org); the dataset states no licence of its own.',
  },
})

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.public.tabulaPeutingerianaEnabled) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  await enforceRateLimit(event, 'tiles')
  const sql = useSql()

  const places = await sql<
    { id: number; label: string; modernName: string | null; lon: number; lat: number }[]
  >`
    SELECT id, label, modern_name AS "modernName", ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM tabula_peutingeriana_places
  `

  const roads = await sql<
    {
      id: number
      distanceRomanMiles: number | null
      isReconstructed: boolean
      overWater: boolean
      crossesMountains: boolean
      crossesRiver: string | null
      geojson: string
    }[]
  >`
    SELECT
      id, distance_roman_miles AS "distanceRomanMiles", is_reconstructed AS "isReconstructed",
      over_water AS "overWater", crosses_mountains AS "crossesMountains", crosses_river AS "crossesRiver",
      ST_AsGeoJSON(geom) AS geojson
    FROM tabula_peutingeriana_roads
  `

  setResponseHeaders(event, {
    'content-type': 'application/geo+json',
    'cache-control': 'public, max-age=86400',
  })

  return {
    type: 'FeatureCollection' as const,
    features: [
      ...places.map((place) => ({
        type: 'Feature' as const,
        id: place.id,
        geometry: { type: 'Point' as const, coordinates: [place.lon, place.lat] },
        properties: {
          kind: 'place' as const,
          label: place.label,
          modernName: place.modernName,
        },
      })),
      ...roads.map((road) => ({
        type: 'Feature' as const,
        id: road.id,
        geometry: JSON.parse(road.geojson) as {
          type: 'LineString'
          coordinates: [number, number][]
        },
        properties: {
          kind: 'road' as const,
          distanceRomanMiles: road.distanceRomanMiles,
          isReconstructed: road.isReconstructed,
          overWater: road.overWater,
          crossesMountains: road.crossesMountains,
          crossesRiver: road.crossesRiver,
        },
      })),
    ],
  }
})
