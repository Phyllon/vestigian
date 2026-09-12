/**
 * The reader's own traces, as GeoJSON for a client-side map layer.
 *
 * **This is deliberately not a tile route, and must not become one.** Tile
 * invalidation in this project is a single global counter (`bumpDataVersion()`)
 * — that is what lets a tile be cached far longer than its editable content
 * would normally allow, and it is the reason the map is fast. Adding a per-user
 * layer inside `ST_AsMVT` would make the cache key per-user and throw the whole
 * arrangement away for a few hundred points.
 *
 * A few hundred points is the operative fact. The MVT pipeline exists because
 * 61,272 sites cannot go down the wire as GeoJSON; one person's visits can, in
 * a single response, and MapLibre draws them from a plain `geojson` source
 * layered above the tiles.
 */
defineRouteMeta({
  openAPI: {
    tags: ['me'],
    summary: 'The caller’s visits and to-visit list as GeoJSON',
    description:
      'A FeatureCollection for the map overlay. Deliberately not a tile route: per-user state would make the global tile cache per-user. Never cached beyond the browser.',
  },
})

export default defineEventHandler(async (event) => {
  const userId = (await requireActiveUser(event)).id
  await enforceRateLimit(event, 'record')

  const places = await readNotebookPlaces(userId)

  setResponseHeader(event, 'content-type', 'application/geo+json')
  setResponseHeader(event, 'cache-control', 'private, no-store')

  return {
    type: 'FeatureCollection' as const,
    features: places.map((place) => ({
      type: 'Feature' as const,
      id: place.siteId,
      geometry: { type: 'Point' as const, coordinates: [place.longitude, place.latitude] },
      properties: {
        siteId: place.siteId,
        slug: place.slug,
        title: place.title,
        category: place.category,
        visited: place.visited,
        bookmarked: place.bookmarked,
        visitedOn: place.visitedOn,
      },
    })),
  }
})
