<script setup lang="ts">
  /**
   * The general app menu, kept separate from the map's own floating chrome —
   * the "Key" button occupies the map's bottom-left corner, and a licence link
   * pinned there overlapped it. This one lives in the header instead, so it is
   * available everywhere without competing for space with a specific page's
   * controls, and grows in one place as more site-wide links arrive.
   */
  const { t } = useI18n()

  const items = computed(() => [
    [{ label: t('layout.footerLicence'), icon: 'i-lucide-scale', to: '/licence' }],
  ])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'start' }">
    <button
      type="button"
      class="grid size-9 place-items-center rounded-notebook text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-label="t('layout.menu')"
      :title="t('layout.menu')"
    >
      <UIcon name="i-lucide-menu" class="size-4" />
    </button>
  </UDropdownMenu>
</template>
