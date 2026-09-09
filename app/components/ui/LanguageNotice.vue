<script setup lang="ts">
  /**
   * English is the only catalogue that gets more than an occasional audit
   * pass — every other locale is bootstrapped by machine translation and can
   * drift from the intended meaning between audits (see
   * `.claude/rules/enrichment-and-i18n.md`'s translation-bug history). Shown
   * only while a non-English locale is active, since that is the one
   * audience actually relying on the less-checked text; an English-reading
   * majority gets nothing extra to look past.
   *
   * Dismissal is remembered per locale in `localStorage`, read only from
   * `onMounted` rather than a `useState` factory — `useOfflineAreas` hit
   * exactly this bug once already: a factory runs during SSR, where
   * `localStorage` doesn't exist, and Nuxt then hydrates the client from
   * whatever the factory returned on the server rather than re-running it.
   */
  const DISMISS_KEY = 'vestigian-language-notice-dismissed'

  const { locale, currentName, setLocale } = useUiLocale()
  const { t } = useI18n()

  const dismissedFor = ref<string | null>(null)
  const isVisible = computed(() => locale.value !== 'en' && dismissedFor.value !== locale.value)

  const dismiss = (): void => {
    dismissedFor.value = locale.value
    try {
      localStorage.setItem(DISMISS_KEY, locale.value)
    } catch {
      // Private browsing / storage blocked: the notice just reappears next visit.
    }
  }

  const switchToEnglish = (): void => {
    void setLocale('en')
  }

  onMounted(() => {
    try {
      dismissedFor.value = localStorage.getItem(DISMISS_KEY)
    } catch {
      dismissedFor.value = null
    }
  })
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    leave-active-class="transition duration-150 ease-in"
    enter-from-class="-translate-y-1 opacity-0"
    leave-to-class="-translate-y-1 opacity-0"
  >
    <div
      v-if="isVisible"
      role="note"
      class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-paper-300 bg-paper-200/80 px-4 py-2 text-center text-xs text-ink-600 dark:border-night-600 dark:bg-night-800/80 dark:text-paper-300 sm:text-sm"
    >
      <span>{{ t('languageNotice.body', { language: currentName }) }}</span>
      <button
        type="button"
        class="font-medium underline underline-offset-2 hover:text-ink-900 dark:hover:text-paper-50"
        @click="switchToEnglish"
      >
        {{ t('languageNotice.switchToEnglish') }}
      </button>
      <button
        type="button"
        class="text-ink-500 hover:text-ink-900 dark:text-paper-400 dark:hover:text-paper-50"
        :aria-label="t('languageNotice.dismiss')"
        @click="dismiss"
      >
        ✕
      </button>
    </div>
  </Transition>
</template>
