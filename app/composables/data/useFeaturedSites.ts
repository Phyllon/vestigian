import type { Map as MapLibreMap } from 'maplibre-gl'
import type { FeaturedSiteSummary } from '#shared/types'

/** Wide enough to be a neighbourhood at city zoom, capped so a continental view stays a local list. */
const MINIMUM_RADIUS_METRES = 1_000
const MAXIMUM_RADIUS_METRES = 300_000

/**
 * Half the visible diagonal, so the list covers what is on screen rather than
 * a fixed circle around the middle of it.
 */
export const radiusForViewport = (map: MapLibreMap): number => {
  const centre = map.getCenter()
  const corner = map.getBounds().getNorthEast()
  const metres = centre.distanceTo(corner)
  return Math.round(Math.min(Math.max(metres, MINIMUM_RADIUS_METRES), MAXIMUM_RADIUS_METRES))
}

/**
 * The "featured nearby" list: sites with a photograph and a description around
 * the camera, best documented first (see `shared/utils/featured.ts`).
 *
 * The open flag lives in `useState` because the button that toggles it and the
 * panel that shows it are separate components in different corners of the map.
 */
export const useFeaturedSites = () => {
  const isOpen = useState<boolean>('featured-sites-open', () => false)
  const items = useState<FeaturedSiteSummary[]>('featured-sites', () => [])
  const isLoading = useState<boolean>('featured-sites-loading', () => false)
  const hasLoaded = useState<boolean>('featured-sites-loaded', () => false)

  let requestToken = 0

  const loadAround = async (map: MapLibreMap): Promise<void> => {
    const token = ++requestToken
    const centre = map.getCenter()
    isLoading.value = true

    try {
      const found = await $fetch<FeaturedSiteSummary[]>('/api/sites/featured', {
        query: { lon: centre.lng, lat: centre.lat, radius: radiusForViewport(map) },
      })
      // A later pan superseded this request; its answer is for the wrong place.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token !== requestToken) return
      items.value = found
      hasLoaded.value = true
    } catch {
      // Keep whatever was showing: a failed refresh while panning is better
      // left as a slightly stale list than as an empty one.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token === requestToken) hasLoaded.value = true
    } finally {
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token === requestToken) isLoading.value = false
    }
  }

  const toggle = (): void => {
    isOpen.value = !isOpen.value
  }

  const close = (): void => {
    isOpen.value = false
  }

  return { isOpen, items, isLoading, hasLoaded, loadAround, toggle, close }
}
