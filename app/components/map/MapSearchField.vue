<script setup lang="ts">
  import type { SiteSummary } from '#shared/types'

  const map = useMapInstance()
  const { term, results, isSearching } = useSiteSearch()
  const { selectSite } = useSiteQuery()

  /**
   * Spoken, not drawn. The list appearing under the field is the whole feedback
   * for a sighted reader; without a live region the same search is silent.
   */
  const searchStatus = computed(() => {
    if (isSearching.value) return 'Searching'
    if (term.value.trim().length === 0) return ''
    if (results.value.length === 0) return 'No matches'
    return `${results.value.length} matches`
  })

  const goToSite = (site: SiteSummary): void => {
    map.value?.flyTo({
      center: [site.position.lon, site.position.lat],
      zoom: 15,
      duration: 1200,
      essential: true,
    })
    selectSite(site.id)
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
      <label for="map-search" class="sr-only">Search sites, roads and places</label>
      <input
        id="map-search"
        v-model="term"
        type="search"
        placeholder="Search sites, roads, places"
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
      aria-label="Search results"
    >
      <li v-for="site in results" :key="site.id">
        <button
          type="button"
          class="flex w-full flex-col items-start border-b border-paper-200 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-paper-100 dark:border-night-700 dark:hover:bg-night-700"
          @click="goToSite(site)"
        >
          <span class="text-sm font-medium text-ink-900 dark:text-paper-100">{{ site.title }}</span>
          <span class="eyebrow">{{ site.category }}</span>
        </button>
      </li>
    </ul>
  </search>
</template>
