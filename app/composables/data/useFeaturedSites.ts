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
 * What a reader chose about the list, kept in `localStorage` under one key.
 *
 * Same class of storage as the intro tour's answer and the language notice's
 * dismissal (see `useIntroTour.ts`): the reader's own explicit act of flipping a
 * switch asks for it, it holds two booleans, it is never a cookie and never sent
 * to us, so no consent banner is needed (§25(2) no. 2 TDDDG, `gdpr-legal.md`).
 * If the key or its contents change, change the disclosure in `privacy.cookiesBody`
 * in all six locales and the storage table in `gdpr-legal.md` with it.
 */
export const FEATURED_STORAGE_KEY = 'vestigian-featured-nearby'

export interface FeaturedPreference {
  /** The list is on the map. */
  isEnabled: boolean
  /** Each row carries a larger photograph and more of its record. */
  isBigPicture: boolean
}

const DEFAULT_PREFERENCE: FeaturedPreference = { isEnabled: false, isBigPicture: false }

/**
 * Reads what `serialiseFeaturedPreference` wrote, and nothing else. Anything
 * missing, malformed or not exactly `true` is "off": the stored value is
 * whatever the browser hands back, including what a person edited by hand or a
 * later version of the app wrote, and a list that opens over half a phone screen
 * must not do so on a guess.
 */
export const parseFeaturedPreference = (raw: string | null): FeaturedPreference => {
  if (raw === null) return { ...DEFAULT_PREFERENCE }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_PREFERENCE }
    const record = parsed as Record<string, unknown>
    return { isEnabled: record.isEnabled === true, isBigPicture: record.isBigPicture === true }
  } catch {
    return { ...DEFAULT_PREFERENCE }
  }
}

export const serialiseFeaturedPreference = (preference: FeaturedPreference): string =>
  JSON.stringify({ isEnabled: preference.isEnabled, isBigPicture: preference.isBigPicture })

const readStoredPreference = (): FeaturedPreference => {
  try {
    return parseFeaturedPreference(localStorage.getItem(FEATURED_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_PREFERENCE }
  }
}

const writeStoredPreference = (preference: FeaturedPreference): void => {
  try {
    localStorage.setItem(FEATURED_STORAGE_KEY, serialiseFeaturedPreference(preference))
  } catch {
    // Private browsing / storage blocked: the choice lasts until the tab closes.
  }
}

/**
 * The "featured nearby" list: sites with a photograph and a description around
 * the camera, best documented first (see `shared/utils/featured.ts`), as many as
 * the endpoint returns by default; the panel scrolls.
 *
 * Two switches, both remembered: whether the list is on the map at all, and
 * whether it is in "big picture" mode, where each entry is a large photograph
 * with its record underneath. Big picture is set from a button in the list's
 * own header, so it can only be changed while the list is showing; its value is
 * kept while the list is off, so switching the list back on returns to the size
 * the reader left it at.
 *
 * The state lives in `useState` because the switches (in the settings menu)
 * and the list (over the map) are separate components in different corners.
 * It is *not* read from `localStorage` here: this runs during SSR, where there is
 * no storage, and Nuxt then hydrates the client from whatever the server
 * returned. `restore` reads it, once, from a component's `onMounted`.
 */
export const useFeaturedSites = () => {
  const isEnabled = useState<boolean>('featured-sites-enabled', () => DEFAULT_PREFERENCE.isEnabled)
  const isBigPicture = useState<boolean>(
    'featured-sites-big-picture',
    () => DEFAULT_PREFERENCE.isBigPicture,
  )
  const hasRestored = useState<boolean>('featured-sites-restored', () => false)
  const items = useState<FeaturedSiteSummary[]>('featured-sites', () => [])
  const isLoading = useState<boolean>('featured-sites-loading', () => false)
  const hasLoaded = useState<boolean>('featured-sites-loaded', () => false)

  let requestToken = 0

  /** Client-only — call from `onMounted`. Idempotent, so every component that needs it may. */
  const restore = (): void => {
    if (hasRestored.value) return
    hasRestored.value = true
    const stored = readStoredPreference()
    isEnabled.value = stored.isEnabled
    isBigPicture.value = stored.isBigPicture
  }

  const remember = (): void => {
    writeStoredPreference({ isEnabled: isEnabled.value, isBigPicture: isBigPicture.value })
  }

  const setEnabled = (next: boolean): void => {
    isEnabled.value = next
    remember()
  }

  const setBigPicture = (next: boolean): void => {
    isBigPicture.value = next
    remember()
  }

  const loadAround = async (map: MapLibreMap): Promise<void> => {
    const token = ++requestToken
    const centre = map.getCenter()
    isLoading.value = true

    try {
      const found = await $fetch<FeaturedSiteSummary[]>('/api/sites/featured', {
        query: {
          lon: centre.lng,
          lat: centre.lat,
          radius: radiusForViewport(map),
        },
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

  return {
    isEnabled,
    isBigPicture,
    items,
    isLoading,
    hasLoaded,
    restore,
    setEnabled,
    setBigPicture,
    loadAround,
  }
}
