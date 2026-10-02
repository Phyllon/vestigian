<script setup lang="ts">
  import { useDebounceFn } from '@vueuse/core'
  import type { FeaturedSiteSummary } from '#shared/types'

  /**
   * Sites with a photograph around wherever the camera is, as a list a reader
   * can jump through. On a phone it is a short sheet along the bottom edge —
   * capped at 45% of the dynamic viewport height so the map stays visible
   * above it and the rows scroll inside it; from `md` it is a card beside the
   * control column instead of on top of it.
   *
   * Picking a row does what tapping the marker would: the camera goes to the
   * site, the selection ring is drawn by `MapCanvas`'s own `selectedSiteId`
   * watcher, and the detail panel opens. The sites layer is switched on first,
   * because with it off there is no marker to ring.
   */
  const { isOpen, items, isLoading, hasLoaded, loadAround, close } = useFeaturedSites()
  const { selectSite, isPanelOpen, isTracingPanelOpen, isPickerOpen } = useSiteQuery()
  const { setSitesActive } = useBasemapStyle()
  const { isCompact } = useBreakpoint()
  const { t } = useI18n()
  const map = useMapInstance()

  const FLY_ZOOM_FLOOR = 14

  // The record panels are a 26rem rail down the right edge from `md`; the list
  // steps left of it rather than hiding underneath, the way the control column
  // does for the frontier panel on the other side.
  const isRecordPanelOpen = computed(
    () => isPanelOpen.value || isTracingPanelOpen.value || isPickerOpen.value,
  )

  const heading = useTemplateRef('heading')

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

  const chooseSite = (site: FeaturedSiteSummary): void => {
    setSitesActive(true)
    map.value?.flyTo({
      center: [site.position.lon, site.position.lat],
      zoom: Math.max(map.value.getZoom(), FLY_ZOOM_FLOOR),
      duration: 1200,
      essential: true,
    })
    selectSite(site.id)
    // On a phone the detail sheet takes the same bottom edge; on a wide screen
    // the list stays so the reader can step to the next one.
    if (isCompact.value) close()
  }

  const refreshDebounced = useDebounceFn((instance: Parameters<typeof loadAround>[0]) => {
    void loadAround(instance)
  }, 400)

  /**
   * Only listens while the list is open, so a reader who never opens it costs
   * the map nothing — no request, no `moveend` handler.
   */
  watch(
    () => [map.value, isOpen.value] as const,
    ([instance, open], _previous, onCleanup) => {
      if (!instance || !open) return
      void loadAround(instance)
      const onMoveEnd = (): void => {
        void refreshDebounced(instance)
      }
      instance.on('moveend', onMoveEnd)
      onCleanup(() => instance.off('moveend', onMoveEnd))
    },
    { immediate: true },
  )

  watch(isOpen, async (open) => {
    if (!open) return
    await nextTick()
    heading.value?.focus()
  })
</script>

<template>
  <!--
    Escape delegate only, as in `OverlaySwitcher`: the section is not
    interactive itself, it catches the key bubbling from the controls inside.
  -->
  <!-- eslint-disable vuejs-accessibility/no-static-element-interactions -->
  <section
    v-if="isOpen"
    id="featured-sites"
    aria-labelledby="featured-sites-heading"
    class="leaf pointer-events-auto absolute inset-x-3 bottom-10 z-20 flex max-h-[45dvh] flex-col md:inset-x-auto md:bottom-10 md:max-h-[60dvh] md:w-80"
    :class="isRecordPanelOpen ? 'md:right-[28rem]' : 'md:right-[4.75rem]'"
    @keydown.esc="close"
  >
    <header
      class="flex items-center gap-2 border-b border-paper-200 px-4 py-2 dark:border-night-700"
    >
      <h2
        id="featured-sites-heading"
        ref="heading"
        tabindex="-1"
        class="eyebrow flex-1 outline-none"
      >
        {{ t('featuredSites.title') }}
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        :aria-label="t('featuredSites.close')"
        @click="close"
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

    <ul v-else class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <li
        v-for="site in items"
        :key="site.id"
        class="border-b border-paper-200 last:border-b-0 dark:border-night-700"
      >
        <button
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
      </li>
    </ul>
  </section>
</template>
