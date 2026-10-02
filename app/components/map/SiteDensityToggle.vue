<script setup lang="ts">
  /**
   * Counted clusters or every site as its own marker. Lives on the map beside
   * the other floating buttons rather than inside the overlay menu: it is a
   * reading of the sites layer the reader flips while looking at the map, and
   * the menu closes on outside click and sits under a count badge.
   */
  const { isShowingSites, isClusteringSites, setSitesClustered } = useBasemapStyle()
  const { t } = useI18n()

  const isShowingEverySite = computed(() => !isClusteringSites.value)

  const label = computed(() =>
    isShowingEverySite.value ? t('siteDensity.showClusters') : t('siteDensity.showEverySite'),
  )
</script>

<template>
  <button
    v-if="isShowingSites"
    type="button"
    class="leaf grid size-11 place-items-center transition hover:bg-paper-200 dark:hover:bg-night-700"
    :class="
      isShowingEverySite ? 'text-oxide-600 dark:text-oxide-300' : 'text-ink-700 dark:text-paper-200'
    "
    :aria-pressed="isShowingEverySite"
    :aria-label="label"
    :title="label"
    @click="setSitesClustered(isShowingEverySite)"
  >
    <UIcon
      :name="isShowingEverySite ? 'i-lucide-map-pin' : 'i-lucide-bubbles'"
      class="size-5"
      aria-hidden="true"
    />
  </button>
</template>
