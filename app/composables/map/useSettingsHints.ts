/**
 * The map settings that are not always there. A row that only exists while some
 * other feature is on is invisible to someone who has never opened the popover
 * since: nothing on the closed gear says "there is something new in here now".
 * `SettingsMenu` puts a dot on the gear while one of these is available and the
 * reader has not yet looked, and tags its row "New" until the popover closes.
 *
 * Add an id here, and a matching availability entry in `SettingsMenu.vue`, when a
 * new row appears conditionally. A row that is always present needs neither.
 */
export const SETTINGS_OPTION_IDS = ['every-site'] as const

export type SettingsOptionId = (typeof SETTINGS_OPTION_IDS)[number]

/**
 * Which of those the reader has already had in front of them, kept in
 * `localStorage` under one key as a JSON array of ids.
 *
 * Same class of storage as the featured list's choice (`useFeaturedSites.ts`):
 * written by the reader's own act of opening the settings, a short list of
 * fixed ids, never a cookie and never sent to us (§25(2) no. 2 TDDDG,
 * `gdpr-legal.md`). If the key or its contents change, change the disclosure in
 * `privacy.cookiesBody` in all six locales and the storage table in
 * `gdpr-legal.md` with it.
 */
export const SETTINGS_SEEN_STORAGE_KEY = 'vestigian-settings-seen'

/**
 * Reads what `serialiseSeenSettingsOptions` wrote. Only ids this build knows
 * survive: a value from a later version, or one edited by hand, must neither
 * throw nor hide an option the reader has not actually met — a dropped id costs
 * one more dot, a trusted stray one costs a hint that never shows.
 */
export const parseSeenSettingsOptions = (raw: string | null): SettingsOptionId[] => {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return SETTINGS_OPTION_IDS.filter((id) => parsed.includes(id))
  } catch {
    return []
  }
}

export const serialiseSeenSettingsOptions = (seen: readonly SettingsOptionId[]): string =>
  JSON.stringify(seen)

const readStoredSeenOptions = (): SettingsOptionId[] => {
  try {
    return parseSeenSettingsOptions(localStorage.getItem(SETTINGS_SEEN_STORAGE_KEY))
  } catch {
    return []
  }
}

const writeStoredSeenOptions = (seen: readonly SettingsOptionId[]): void => {
  try {
    localStorage.setItem(SETTINGS_SEEN_STORAGE_KEY, serialiseSeenSettingsOptions(seen))
  } catch {
    // Private browsing / storage blocked: the hint comes back next visit.
  }
}

/**
 * The state lives in `useState` for the reason `useFeaturedSites` gives: it is
 * never read from `localStorage` while the server renders, because the client
 * would hydrate from the server's empty answer. `restore` reads it once, from a
 * component's `onMounted`; `hasRestored` lets a caller hold the hint back until
 * then, so a reader who has seen an option never gets a dot for the moment
 * before their answer is read.
 */
export const useSettingsHints = () => {
  const seenOptions = useState<SettingsOptionId[]>('settings-options-seen', () => [])
  const hasRestored = useState<boolean>('settings-options-restored', () => false)

  /** Client-only — call from `onMounted`. Idempotent. */
  const restore = (): void => {
    if (hasRestored.value) return
    hasRestored.value = true
    seenOptions.value = readStoredSeenOptions()
  }

  /** Marks these options as met. Nothing is written when none of them is new. */
  const acknowledge = (ids: readonly SettingsOptionId[]): void => {
    const fresh = ids.filter((id) => !seenOptions.value.includes(id))
    if (fresh.length === 0) return
    seenOptions.value = [...seenOptions.value, ...fresh]
    writeStoredSeenOptions(seenOptions.value)
  }

  return { seenOptions, hasRestored, restore, acknowledge }
}
