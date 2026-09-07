/**
 * Where a reader left off in a plate volume, remembered across navigation.
 *
 * The column viewers are the one place in this app where a visit is a
 * position rather than a destination: 128 plates of the Marcus column and 138
 * of Trajan's are read a few at a time, and coming back to plate 1 after
 * clicking through to a site record and back makes the second sitting start
 * over. The route carries no page — deliberately, since a plate index is not
 * something anyone would type or share — so the position has to live
 * somewhere else.
 *
 * `localStorage`, not `useState`: a client-side navigation away and back is
 * the *smallest* gap this has to survive, and a reload or a new tab the next
 * evening is the case that actually matters. It is read only from `recall()`,
 * never from a `useState` factory — that factory runs during SSR, where
 * `localStorage` does not exist, and Nuxt then serialises the server's answer
 * into the payload and hydrates the client from it rather than re-invoking
 * the factory, so a "client-only" branch inside one silently never runs. That
 * exact trap already cost this project its offline-area list once; see
 * `.claude/rules/map-and-tiles.md`.
 *
 * Failing quietly is the right behaviour throughout: a reader in a private
 * window, or with site data blocked, gets a viewer that starts at plate 1
 * rather than a viewer that does not start.
 */
const STORAGE_KEY = 'vestigian:column-plate-position'

/**
 * A stored value is whatever was in the browser last time, which may be from
 * an older release, hand-edited, or not JSON at all. Anything that is not a
 * flat map of non-negative integers is discarded rather than repaired.
 */
export const parseRememberedPages = (raw: string | null): Record<string, number> => {
  if (!raw) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

  const pages: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) pages[key] = value
  }
  return pages
}

/**
 * A remembered page can outlive the volume it was stored for — a re-import
 * that drops a corrupt plate shortens the sequence, and OpenSeadragon throws
 * for a page index past the end rather than clamping. Out of range reads as
 * "no position", not as the last plate: landing on the end of a volume you
 * were in the middle of is more confusing than starting again.
 */
export const clampPage = (page: number | undefined, total: number): number => {
  if (page === undefined || total <= 0) return 0
  return page >= 0 && page < total ? page : 0
}

export const useColumnPlatePosition = () => {
  const readAll = (): Record<string, number> => {
    if (!import.meta.client) return {}
    try {
      return parseRememberedPages(window.localStorage.getItem(STORAGE_KEY))
    } catch {
      return {}
    }
  }

  /** The page to open `viewerKey` at, already checked against this volume's real length. */
  const recall = (viewerKey: string, total: number): number =>
    clampPage(readAll()[viewerKey], total)

  const remember = (viewerKey: string, page: number): void => {
    if (!import.meta.client) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [viewerKey]: page }))
    } catch {
      // Quota, a private window, or site data blocked — see the file docstring.
    }
  }

  return { recall, remember }
}
