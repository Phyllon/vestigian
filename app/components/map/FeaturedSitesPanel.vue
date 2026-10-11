<script setup lang="ts">
  import { useDebounceFn } from '@vueuse/core'
  import type { FeaturedSiteSummary } from '#shared/types'

  /**
   * Sites with a photograph around wherever the camera is (the endpoint's best
   * eight), as a
   * list a reader can jump through. It stays on the map for as long as the
   * switch in `SettingsMenu` is on — and that choice is remembered — so it is
   * built to sit there: the compact list is never taller than half the dynamic
   * viewport, the rows scroll inside it, and the controls it could have covered
   * are left clear.
   *
   * On a phone it is a sheet along the bottom edge, lifted past the key and
   * stopping short of the control column on the right (both stay reachable;
   * the column holds the switch that turns this off). From `md` it is a card
   * beside that column instead. A record panel covers it on a phone — the
   * detail sheet takes the same edge — and it returns when the record closes,
   * rather than being turned off, because the switch is the reader's, not the
   * panel's to throw away.
   *
   * "Big picture" is one site at a time: its photograph takes about 40% of the
   * screen's height (44% from `md`) with the text underneath, and the entries snap
   * past vertically. That is deliberately more than the compact list's half-screen
   * budget in total — the photograph is the point of the mode — so the sheet is
   * capped by what is left clear of the controls above it, not by a fraction.
   * Under the photograph: when it dates from, where it is, the start of its
   * summary, how well documented it is, and the photograph's credit.
   *
   * Picking a row does what tapping the marker would: the camera goes to the
   * site, the selection ring is drawn by `MapCanvas`'s own `selectedSiteId`
   * watcher, and the detail panel opens. The sites layer is switched on first,
   * because with it off there is no marker to ring.
   */
  const {
    isEnabled,
    isBigPicture,
    items,
    isLoading,
    hasLoaded,
    loadAround,
    restore,
    setEnabled,
    setBigPicture,
  } = useFeaturedSites()
  const { selectSite, isPanelOpen, isTracingPanelOpen, isPickerOpen } = useSiteQuery()
  const { setSitesActive } = useBasemapStyle()
  const { buildCredit } = useImageUrl()
  const { countryName } = useCountryName()
  const { t } = useI18n()
  const map = useMapInstance()

  const FLY_ZOOM_FLOOR = 14

  // The record panels are a 26rem rail down the right edge from `md`; the list
  // steps left of it rather than hiding underneath, the way the control column
  // does for the frontier panel on the other side.
  const isRecordPanelOpen = computed(
    () => isPanelOpen.value || isTracingPanelOpen.value || isPickerOpen.value,
  )

  const distanceLabel = (metres: number): string =>
    metres < 1000
      ? t('featuredSites.metres', { metres })
      : t('featuredSites.kilometres', {
          kilometres: (metres / 1000).toFixed(metres < 10_000 ? 1 : 0),
        })

  const statusMessage = computed(() => {
    if (isLoading.value && items.value.length === 0) return t('featuredSites.loading')
    if (hasLoaded.value && items.value.length === 0) return t('featuredSites.empty')
    return t('featuredSites.count', { n: items.value.length }, items.value.length)
  })

  /** "AD 100 – AD 300", or nothing: a record with no dates has no period worth a line. */
  const periodLabel = (site: FeaturedSiteSummary): string | null =>
    site.periodFrom === null && site.periodTo === null
      ? null
      : formatPeriod(site.periodFrom, site.periodTo, t)

  /**
   * Most vici summaries are a sentence; some are the title again, which would
   * read as the same line twice under it.
   */
  const summaryFor = (site: FeaturedSiteSummary): string | null =>
    site.summary && site.summary.toLowerCase() !== site.title.trim().toLowerCase()
      ? site.summary
      : null

  const placeLabel = (site: FeaturedSiteSummary): string | null =>
    [site.modernPlace, countryName(site.countryCode)].filter(Boolean).join(', ') || null

  const chooseSite = (site: FeaturedSiteSummary): void => {
    setSitesActive(true)
    map.value?.flyTo({
      center: [site.position.lon, site.position.lat],
      zoom: Math.max(map.value.getZoom(), FLY_ZOOM_FLOOR),
      duration: 1200,
      essential: true,
    })
    selectSite(site.id)
  }

  const refreshDebounced = useDebounceFn((instance: Parameters<typeof loadAround>[0]) => {
    void loadAround(instance)
  }, 400)

  /**
   * Only listens while the list is on, so a reader who never switches it on
   * costs the map nothing — no request, no `moveend` handler.
   */
  watch(
    () => [map.value, isEnabled.value] as const,
    ([instance, enabled], _previous, onCleanup) => {
      if (!instance || !enabled) return
      void loadAround(instance)
      const onMoveEnd = (): void => {
        void refreshDebounced(instance)
      }
      instance.on('moveend', onMoveEnd)
      onCleanup(() => instance.off('moveend', onMoveEnd))
    },
    { immediate: true },
  )

  // Last, and in the browser only: the saved choice is read after hydration so
  // the server's markup (list off) and the first client render agree.
  onMounted(restore)
</script>

<template>
  <!--
    Escape delegate only, as in `OverlaySwitcher`: the section is not
    interactive itself, it catches the key bubbling from the controls inside.
  -->
  <!-- eslint-disable vuejs-accessibility/no-static-element-interactions -->
  <section
    v-if="isEnabled"
    id="featured-sites"
    aria-labelledby="featured-sites-heading"
    class="leaf pointer-events-auto absolute bottom-[5.5rem] left-3 right-[4.75rem] z-20 flex flex-col md:bottom-10 md:left-auto"
    :class="[
      isBigPicture
        ? 'max-h-[calc(100%_-_9.5rem)] md:max-h-[calc(100%_-_7.5rem)] md:w-[26rem]'
        : 'max-h-[min(50dvh,calc(100%_-_9.5rem))] md:max-h-[50dvh] md:w-80',
      isRecordPanelOpen ? 'max-md:hidden md:right-[28rem]' : 'md:right-[4.75rem]',
    ]"
    @keydown.esc="setEnabled(false)"
  >
    <header
      class="flex items-center gap-1 border-b border-paper-200 py-1.5 pl-4 pr-2 dark:border-night-700"
    >
      <h2 id="featured-sites-heading" class="eyebrow flex-1">
        {{ t('featuredSites.title') }}
      </h2>
      <UButton
        :color="isBigPicture ? 'primary' : 'neutral'"
        :variant="isBigPicture ? 'soft' : 'ghost'"
        size="sm"
        :icon="isBigPicture ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
        :aria-pressed="isBigPicture"
        :aria-label="t('featuredSites.bigPicture')"
        :title="t('featuredSites.bigPicture')"
        @click="setBigPicture(!isBigPicture)"
      />
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        :aria-label="t('featuredSites.turnOff')"
        :title="t('featuredSites.turnOff')"
        @click="setEnabled(false)"
      />
    </header>

    <!-- Spoken, not drawn: the list changing under a pan is silent otherwise. -->
    <p class="sr-only" role="status">{{ statusMessage }}</p>

    <p
      v-if="items.length === 0"
      class="px-4 py-5 text-sm text-ink-500 dark:text-paper-400"
      aria-hidden="true"
    >
      {{ statusMessage }}
    </p>

    <ul
      v-else
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      :class="isBigPicture ? 'snap-y snap-mandatory' : ''"
    >
      <li
        v-for="site in items"
        :key="site.id"
        class="border-b border-paper-200 last:border-b-0 dark:border-night-700"
        :class="isBigPicture ? 'snap-start' : ''"
      >
        <button
          v-if="!isBigPicture"
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-paper-200 focus-visible:bg-paper-200 dark:hover:bg-night-700 dark:focus-visible:bg-night-700"
          @click="chooseSite(site)"
        >
          <img
            :src="`/api/images/${site.thumbnailImageId}/thumb`"
            alt=""
            width="48"
            height="48"
            loading="lazy"
            decoding="async"
            class="size-12 shrink-0 rounded-sm bg-paper-200 object-cover dark:bg-night-700"
          />
          <span class="min-w-0">
            <span class="block truncate font-medium text-ink-900 dark:text-paper-100">
              {{ site.title }}
            </span>
            <span class="eyebrow block truncate">
              {{ t(`categories.${site.category}`) }} · {{ distanceLabel(site.distanceMetres) }}
            </span>
          </span>
        </button>

        <button
          v-else
          type="button"
          class="block w-full text-left transition hover:bg-paper-200 focus-visible:bg-paper-200 dark:hover:bg-night-700 dark:focus-visible:bg-night-700"
          @click="chooseSite(site)"
        >
          <img
            :src="`/api/images/${site.thumbnailImageId}/card`"
            alt=""
            width="720"
            height="480"
            loading="lazy"
            decoding="async"
            class="block h-[40dvh] w-full bg-paper-200 object-cover md:h-[44dvh] dark:bg-night-700"
          />
          <span class="block space-y-1 px-3 py-2.5">
            <span class="line-clamp-2 block text-base font-medium text-ink-900 dark:text-paper-100">
              {{ site.title }}
            </span>
            <span class="eyebrow block">
              {{ t(`categories.${site.category}`) }}
              <template v-if="periodLabel(site)"> · {{ periodLabel(site) }}</template>
            </span>
            <span class="block text-xs text-ink-700 dark:text-paper-200">
              <template v-if="placeLabel(site)">{{ placeLabel(site) }} · </template>
              {{ distanceLabel(site.distanceMetres) }}
            </span>
            <span
              v-if="summaryFor(site)"
              class="line-clamp-2 block text-xs leading-snug text-ink-700 dark:text-paper-200"
            >
              {{ summaryFor(site) }}
            </span>
            <span class="block text-xs text-ink-500 dark:text-paper-400">
              {{ t('featuredSites.photographs', { n: site.imageCount }, site.imageCount) }}
              <template v-if="site.endorsementCount > 0">
                ·
                {{
                  t('featuredSites.endorsed', { n: site.endorsementCount }, site.endorsementCount)
                }}
              </template>
            </span>
            <span class="block text-[0.7rem] leading-snug text-ink-500 dark:text-paper-400">
              {{
                t('featuredSites.photoCredit', {
                  credit: buildCredit({
                    attribution: site.thumbnailAttribution,
                    licence: site.thumbnailLicence,
                  }),
                })
              }}
            </span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
