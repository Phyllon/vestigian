/**
 * A request, from a page with no map of its own, that a sector's "Watching the
 * frontier" section be open when the panel appears. The section is a native
 * `<details>` closed in the map's sector sheet; the features page's example is
 * about that section, so it would otherwise land the reader on a closed row.
 *
 * Answered once (`takeRequest`) and by slug, so a later sector the reader picks
 * is not opened for them. `useState` survives the client-side navigation, the
 * same reason `useMapFocus` uses it.
 */
export const useSectorWatchOpenRequest = () => {
  const requestedSlug = useState<string | null>('sector-watch-open-request', () => null)

  const requestSectorWatchOpen = (slug: string): void => {
    requestedSlug.value = slug
  }

  /** True once, when the request names this sector; the request is then cleared. */
  const takeRequestFor = (slug: string): boolean => {
    if (requestedSlug.value !== slug) return false
    requestedSlug.value = null
    return true
  }

  return { requestSectorWatchOpen, takeRequestFor }
}
