<script setup lang="ts">
  const { isOpen, toggle } = useFeaturedSites()
  const { t } = useI18n()

  const label = computed(() => (isOpen.value ? t('featuredSites.hide') : t('featuredSites.show')))
</script>

<template>
  <button
    type="button"
    class="leaf grid size-11 place-items-center transition hover:bg-paper-200 dark:hover:bg-night-700"
    :class="isOpen ? 'text-oxide-600 dark:text-oxide-300' : 'text-ink-700 dark:text-paper-200'"
    :aria-expanded="isOpen"
    aria-controls="featured-sites"
    :aria-label="label"
    :title="label"
    @click="toggle"
  >
    <UIcon name="i-lucide-sparkles" class="size-5" aria-hidden="true" />
  </button>
</template>
