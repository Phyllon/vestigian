/**
 * Contributed sites and tracings as vector tiles. The handler lives in
 * `serveSiteTile` (`server/utils/site-tile.ts`), shared with `/api/tiles/every`.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'Contributed sites and tracings as a vector tile',
    description:
      'The hot path of the application. Counted clusters below zoom 9, individual sites at 9+, tracings from zoom 7. Tiles carry id, slug, title and category only. `/api/tiles/every/{z}/{x}/{y}` is the same tile with individual sites at every zoom instead of clusters.',
  },
})

export default defineEventHandler((event) => serveSiteTile(event, { showEverySite: false }))
