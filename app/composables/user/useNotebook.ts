import type { NotebookPlace } from '~~/server/utils/notebook'

/**
 * The reader's own traces, as one client-side source of truth.
 *
 * Three surfaces need to agree about whether a site is visited: the button in
 * the site panel, the overlay on the map, and the notebook pages. Fetching
 * separately in each would let the map keep drawing a tick after the panel
 * removed one, so the whole set lives in a single `useState` and every toggle
 * writes to it optimistically before the request is sent.
 *
 * Optimistic, and it reverts on failure. Marking a visit is a small, frequent,
 * entirely reversible act — the wrong thing to make someone wait on a round
 * trip for — but a silent failure would leave the interface lying about what
 * the database holds, which for a record of where somebody has been is worse
 * than a moment's latency.
 */

/**
 * Coordinates are carried on the entry, not looked up again, so the map overlay
 * can be rebuilt from this state alone. Without them a toggle would have to
 * re-fetch the whole collection to redraw one marker.
 */
type NotebookEntry = Pick<
  NotebookPlace,
  'siteId' | 'visited' | 'visitedOn' | 'note' | 'bookmarked'
> & {
  longitude: number
  latitude: number
}

export const useNotebook = () => {
  const { loggedIn } = useSession()
  const entries = useState<Map<number, NotebookEntry>>('notebook-entries', () => new Map())
  const isLoaded = useState('notebook-loaded', () => false)
  const isSaving = useState('notebook-saving', () => false)

  /** Loaded once per session, on the first surface that needs it. */
  const load = async (): Promise<void> => {
    if (!loggedIn.value || isLoaded.value) return

    try {
      const collection = await $fetch('/api/me/map.geojson')
      entries.value = new Map(
        collection.features.map((feature) => [
          feature.properties.siteId,
          {
            siteId: feature.properties.siteId,
            visited: feature.properties.visited,
            visitedOn: feature.properties.visitedOn,
            note: null,
            bookmarked: feature.properties.bookmarked,
            longitude: feature.geometry.coordinates[0]!,
            latitude: feature.geometry.coordinates[1]!,
          },
        ]),
      )
      isLoaded.value = true
    } catch {
      // A notebook that will not load must not stop the map rendering. The
      // toggles stay available and each one reports its own failure.
    }
  }

  const entryFor = (siteId: number): NotebookEntry | undefined => entries.value.get(siteId)

  const hasVisited = (siteId: number): boolean => entries.value.get(siteId)?.visited === true
  const hasBookmarked = (siteId: number): boolean => entries.value.get(siteId)?.bookmarked === true

  /** Replaces the map rather than mutating it, so computed watchers re-run. */
  const write = (siteId: number, entry: NotebookEntry | null): void => {
    const next = new Map(entries.value)
    if (entry === null || (!entry.visited && !entry.bookmarked)) next.delete(siteId)
    else next.set(siteId, entry)
    entries.value = next
  }

  interface Position {
    longitude?: number
    latitude?: number
  }

  const current = (siteId: number, position: Position = {}): NotebookEntry =>
    entries.value.get(siteId) ?? {
      siteId,
      visited: false,
      visitedOn: null,
      note: null,
      bookmarked: false,
      longitude: position.longitude ?? 0,
      latitude: position.latitude ?? 0,
    }

  interface VisitInput {
    siteId: number
    visitedOn?: string | null
    note?: string | null
    /**
     * Needed only the first time a site enters the notebook — an entry created
     * from the site panel has no row to read coordinates from yet.
     */
    longitude?: number
    latitude?: number
  }

  const recordVisit = async (input: VisitInput): Promise<void> => {
    const previous = entryFor(input.siteId) ?? null
    write(input.siteId, {
      ...current(input.siteId, input),
      visited: true,
      visitedOn: input.visitedOn ?? null,
      note: input.note ?? null,
    })

    isSaving.value = true
    try {
      await $fetch('/api/me/visits', { method: 'POST', body: input })
    } catch (error) {
      write(input.siteId, previous)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  const removeVisit = async (siteId: number): Promise<void> => {
    const previous = entryFor(siteId) ?? null
    write(siteId, { ...current(siteId), visited: false, visitedOn: null, note: null })

    isSaving.value = true
    try {
      await $fetch(`/api/me/visits/${siteId}`, { method: 'DELETE' })
    } catch (error) {
      write(siteId, previous)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  const toggleBookmark = async (siteId: number, position: Position = {}): Promise<boolean> => {
    const previous = entryFor(siteId) ?? null
    const next = !hasBookmarked(siteId)
    write(siteId, { ...current(siteId, position), bookmarked: next })

    isSaving.value = true
    try {
      if (next) await $fetch('/api/me/bookmarks', { method: 'POST', body: { siteId } })
      else await $fetch(`/api/me/bookmarks/${siteId}`, { method: 'DELETE' })
      return next
    } catch (error) {
      write(siteId, previous)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  /** Every entry as GeoJSON, for the map overlay to draw without a second fetch. */
  const overlay = computed(() => ({
    type: 'FeatureCollection' as const,
    features: [...entries.value.values()].map((entry) => ({
      type: 'Feature' as const,
      id: entry.siteId,
      geometry: { type: 'Point' as const, coordinates: [entry.longitude, entry.latitude] },
      properties: { siteId: entry.siteId, visited: entry.visited, bookmarked: entry.bookmarked },
    })),
  }))

  return {
    entries,
    isLoaded,
    isSaving,
    load,
    entryFor,
    hasVisited,
    hasBookmarked,
    recordVisit,
    removeVisit,
    toggleBookmark,
    overlay,
  }
}
