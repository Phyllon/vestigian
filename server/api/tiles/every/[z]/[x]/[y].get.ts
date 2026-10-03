/**
 * The same tile as `/api/tiles/{z}/{x}/{y}`, with individual sites at every
 * zoom. A separate path rather than `?sites=all` so that no cache keyed on the
 * path alone can serve one mode's tile for the other — see `serveSiteTile`.
 */
defineRouteMeta({
  openAPI: {
    tags: ['tiles'],
    summary: 'Contributed sites and tracings as a vector tile, every site its own marker',
    description:
      'Individual sites at every zoom instead of counted clusters. Below zoom 9 the tile drops slug and period properties to stay small.',
  },
})

export default defineEventHandler((event) => serveSiteTile(event, { showEverySite: true }))
