<script setup lang="ts">
  const { t } = useI18n()
  const { isDark, toggle } = useColorScheme()

  const label = computed(() =>
    isDark.value ? t('themeToggle.switchToDay') : t('themeToggle.switchToNight'),
  )
</script>

<template>
  <ClientOnly>
    <button
      type="button"
      class="grid size-9 place-items-center rounded-notebook text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-label="label"
      :title="label"
      @click="toggle"
    >
      <UIcon :name="isDark ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-4" />
    </button>
    <template #fallback>
      <div class="size-9" />
    </template>
  </ClientOnly>
</template>
