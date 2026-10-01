<script setup lang="ts">
  import { useMediaQuery } from '@vueuse/core'
  import type { MapSearchResult } from '#shared/types'

  const { t } = useI18n()
  const map = useMapInstance()
  const { term, results, isSearching } = useSiteSearch()
  const { selectSite } = useSiteQuery()
  const { countryName } = useCountryName()

  /**
   * Below `sm` this field shares its row with three icon-only controls (see
   * `OverlaySwitcher.vue`/`PeriodSwitcher.vue`/`BasemapSwitcher.vue`, which
   * hide their own text at the same breakpoint for the same reason), leaving
   * too little width for the full placeholder — measured directly, not
   * assumed: German's "Fundorte, Straßen, Orte durchsuchen" was still wider
   * than the field at 375px and 390px. The full wording carries no meaning a
   * short word doesn't already give a sighted reader once they've tapped in —
   * `mapSearch.label` keeps the complete description for a screen reader
   * regardless of which placeholder is showing.
   */
  const isWide = useMediaQuery('(min-width: 640px)')
  const placeholder = computed(() =>
    isWide.value ? t('mapSearch.placeholder') : t('mapSearch.placeholderShort'),
  )

  /**
   * Spoken, not drawn. The list appearing under the field is the whole feedback
   * for a sighted reader; without a live region the same search is silent.
   */
  const searchStatus = computed(() => {
    if (isSearching.value) return t('mapSearch.searching')
    if (term.value.trim().length === 0) return ''
    if (results.value.length === 0) return t('mapSearch.noMatches')
    return t('mapSearch.matches', { count: results.value.length })
  })

  /**
   * A site opens its detail panel; a modern or ancient place is not a
   * Vestigian record — it has nothing to open, so this only moves the
   * camera there. An ancient place gets a closer zoom than a modern town:
   * it marks one small point on the Barrington sheet, not a settlement
   * with its own extent.
   */
  const RESULT_ZOOM: Record<MapSearchResult['kind'], number> = {
    site: 15,
    'ancient-place': 14,
    place: 12,
  }

  const resultTitle = (result: MapSearchResult): string => {
    if (result.kind === 'place') return result.name
    return result.title
  }

  const resultSubtitle = (result: MapSearchResult): string => {
    if (result.kind === 'site') return t(`categories.${result.category}`)
    if (result.kind === 'ancient-place') return t('mapSearch.ancientPlace')
    return t('mapSearch.modernPlace', { country: countryName(result.countryCode) })
  }

  const goToResult = (result: MapSearchResult): void => {
    map.value?.flyTo({
      center: [result.position.lon, result.position.lat],
      zoom: RESULT_ZOOM[result.kind],
      duration: 1200,
      essential: true,
    })
    if (result.kind === 'site') selectSite(result.id)
    term.value = ''
  }

  const searchInput = useTemplateRef('searchInput')

  const clearTerm = (): void => {
    term.value = ''
    searchInput.value?.focus()
  }
</script>

<template>
  <search class="relative block w-full">
    <!--
      The ring is on the sheet rather than the input: the input clears its own
      outline so the field reads as one surface, which would otherwise leave
      keyboard focus with no visible landing place at all.
    -->
    <div
      class="leaf flex items-center gap-2 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-oxide-600"
    >
      <UIcon name="i-lucide-search" class="size-4 shrink-0 text-ink-300" aria-hidden="true" />
      <label for="map-search" class="sr-only">{{ t('mapSearch.label') }}</label>
      <input
        id="map-search"
        ref="searchInput"
        v-model="term"
        type="search"
        :placeholder="placeholder"
        class="w-full bg-transparent py-2.5 text-sm text-ink-900 outline-none placeholder:text-ink-300 dark:text-paper-100"
        autocomplete="off"
        spellcheck="false"
        :aria-busy="isSearching"
      />
      <UIcon
        v-if="isSearching"
        name="i-lucide-loader-circle"
        class="size-4 shrink-0 animate-spin text-ink-300"
        aria-hidden="true"
      />
      <button
        v-if="term.length > 0"
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-ink-700 dark:text-paper-500 dark:hover:bg-night-700 dark:hover:text-paper-100"
        :aria-label="t('mapSearch.clear')"
        @click="clearTerm"
      >
        <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <p class="sr-only" role="status">{{ searchStatus }}</p>

    <ul
      v-if="results.length > 0"
      class="leaf absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto shadow-lifted"
      :aria-label="t('mapSearch.resultsLabel')"
    >
      <li v-for="result in results" :key="`${result.kind}-${result.id}`">
        <button
          type="button"
          class="flex w-full flex-col items-start border-b border-paper-200 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-paper-100 dark:border-night-700 dark:hover:bg-night-700"
          @click="goToResult(result)"
        >
          <span class="text-sm font-medium text-ink-900 dark:text-paper-100">
            {{ resultTitle(result) }}
          </span>
          <span class="eyebrow">
            {{ resultSubtitle(result) }}
          </span>
        </button>
      </li>
    </ul>
  </search>
</template>
