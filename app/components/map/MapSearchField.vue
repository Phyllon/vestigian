<script setup lang="ts">
  import type { MapSearchResult } from '#shared/types'

  const { t } = useI18n()
  const map = useMapInstance()
  const { term, results, isSearching } = useSiteSearch()
  const { selectSite } = useSiteQuery()
  const { countryName } = useCountryName()

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
   * A site opens its detail panel; a modern place is not a Vestigian
   * record — it has nothing to open, so this only moves the camera there.
   */
  const goToResult = (result: MapSearchResult): void => {
    map.value?.flyTo({
      center: [result.position.lon, result.position.lat],
      zoom: result.kind === 'site' ? 15 : 12,
      duration: 1200,
      essential: true,
    })
    if (result.kind === 'site') selectSite(result.id)
    term.value = ''
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
        v-model="term"
        type="search"
        :placeholder="t('mapSearch.placeholder')"
        class="w-full bg-transparent py-2.5 text-sm text-ink-900 outline-none placeholder:text-ink-300 dark:text-paper-100"
        autocomplete="off"
        spellcheck="false"
        :aria-busy="isSearching"
      />
      <UIcon
        v-if="isSearching"
        name="i-lucide-loader-circle"
        class="size-4 animate-spin text-ink-300"
        aria-hidden="true"
      />
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
            {{ result.kind === 'site' ? result.title : result.name }}
          </span>
          <span class="eyebrow">
            {{
              result.kind === 'site'
                ? t(`categories.${result.category}`)
                : t('mapSearch.modernPlace', { country: countryName(result.countryCode) })
            }}
          </span>
        </button>
      </li>
    </ul>
  </search>
</template>
