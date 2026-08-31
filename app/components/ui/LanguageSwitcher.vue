<script setup lang="ts">
  const { t } = useI18n()
  const { locale, availableLocales, currentName, setLocale } = useUiLocale()

  const items = computed(() => [
    availableLocales.value.map((option: { code: string; name: string }) => ({
      label: option.name,
      checked: option.code === locale.value,
      type: 'checkbox' as const,
      onSelect: () => setLocale(option.code),
    })),
  ])
</script>

<template>
  <ClientOnly>
    <UDropdownMenu :items="items" :content="{ align: 'end' }">
      <button
        type="button"
        class="grid size-9 place-items-center rounded-notebook text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
        :aria-label="t('languageSwitcher.current', { name: currentName })"
        :title="t('languageSwitcher.current', { name: currentName })"
      >
        <UIcon name="i-lucide-languages" class="size-4" />
      </button>
    </UDropdownMenu>
    <template #fallback>
      <div class="size-9" />
    </template>
  </ClientOnly>
</template>
