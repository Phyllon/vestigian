import { useStorage } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'
import type { SiteEnrichment } from '#shared/types'

/**
 * Borrowed prose for the site that is currently open, fetched when it opens.
 *
 * Most sites have none — only a small minority can be matched to an outside
 * record with certainty — so this resolves to null far more often than not,
 * and the panel renders nothing at all in that case.
 *
 * Two caches sit in front of the endpoint, doing different jobs. Nuxt's
 * per-key payload cache stops a re-fetch while the tab is open; localStorage
 * carries the answer across reloads, which is what makes reopening a site you
 * looked at yesterday feel instant. Neither is a record of anything: both
 * expire, and the licence on this text is a reason not to keep it any longer
 * than convenience requires.
 */
const STORAGE_KEY = 'vestigian-enrichment'

/** Bumped when the shape changes, so an old cache is discarded rather than parsed. */
const STORAGE_SCHEMA = 3

const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Enough to cover a session's browsing without growing without bound. */
const STORAGE_LIMIT = 60

interface StoredEntry {
  schema: number
  storedAt: number
  /** Null is a real answer — "checked, nothing certain" — and worth caching. */
  value: SiteEnrichment | null
}

/**
 * Takes the site to enrich rather than assuming the map's selection, because
 * the full entry page at `/site/[slug]` renders the same panel content without
 * ever touching `selectedSiteId`. Defaults to the selection so the map panel
 * can call it with no argument.
 */
export const useSiteEnrichment = (source?: MaybeRefOrGetter<number | null | undefined>) => {
  const { selectedSiteId } = useSiteQuery()
  const { locale } = useI18n()

  const siteId = computed<number | null>(() =>
    source === undefined ? selectedSiteId.value : (toValue(source) ?? null),
  )

  const remembered = useStorage<Record<string, StoredEntry>>(STORAGE_KEY, {})

  /**
   * Storage key includes the language, so switching the interface language
   * refetches rather than replaying yesterday's English translation under a
   * new label.
   */
  const storageKey = (siteId: number, lang: string): string => `${siteId}:${lang}`

  const readRemembered = (siteId: number, lang: string): StoredEntry | null => {
    const entry = remembered.value[storageKey(siteId, lang)]
    if (!entry || entry.schema !== STORAGE_SCHEMA) return null
    if (Date.now() - entry.storedAt > STORAGE_TTL_MS) return null
    return entry
  }

  const remember = (siteId: number, lang: string, value: SiteEnrichment | null): void => {
    const next: Record<string, StoredEntry> = {
      ...remembered.value,
      [storageKey(siteId, lang)]: { schema: STORAGE_SCHEMA, storedAt: Date.now(), value },
    }

    // Oldest out first, so a long session cannot fill the origin's quota.
    // Rebuilt rather than pruned in place: deleting computed keys is banned by
    // the lint rules, and keeping the newest N reads more plainly anyway.
    const newest = Object.entries(next)
      .sort(([, a], [, b]) => b.storedAt - a.storedAt)
      .slice(0, STORAGE_LIMIT)

    remembered.value = Object.fromEntries(newest)
  }

  /**
   * Keyed per site and language, unlike the detail query beside it, so
   * switching back to a site already seen this session in this language costs
   * nothing — and switching language refetches rather than reusing a
   * translation into the language just left.
   */
  const { data: enrichment, status } = useLazyAsyncData<SiteEnrichment | null>(
    () => `site-enrichment-${siteId.value ?? 'none'}-${locale.value}`,
    async () => {
      const id = siteId.value
      if (id === null) return null

      const lang = locale.value
      const stored = readRemembered(id, lang)
      if (stored) return stored.value

      const fetched = await $fetch<SiteEnrichment | null>(`/api/sites/${id}/enrichment`, {
        query: { lang },
      })
      remember(id, lang, fetched)
      return fetched
    },
    { watch: [siteId, locale], server: false, default: () => null },
  )

  /**
   * Pending only while there is something to wait for. Without the id check
   * the panel would flash a skeleton for the majority of sites that never had
   * a chance of an answer.
   */
  const isLoadingEnrichment = computed(() => siteId.value !== null && status.value === 'pending')

  return { enrichment, isLoadingEnrichment }
}
