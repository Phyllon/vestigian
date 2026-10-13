<script setup lang="ts">
  /**
   * The sentence a reuser or partner pastes to credit this atlas, with a copy
   * button. Shared by `/licence` and `/partners` so the wording and the copied
   * state cannot drift apart; each page supplies its own heading.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const creditLine = computed(() => t('licence.reuseCreditBody', { url: base }))
  const { copy, copied, isSupported } = useClipboard({ copiedDuring: 2000 })
</script>

<template>
  <div class="flex items-start gap-3">
    <blockquote
      class="min-w-0 flex-1 rounded-r-sm border-l-2 border-paper-400 py-1 pl-3 text-sm leading-relaxed text-ink-700 transition-colors duration-300 dark:text-paper-200"
      :class="copied ? 'bg-verdigris-100 dark:bg-verdigris-900/40' : 'bg-transparent'"
    >
      {{ creditLine }}
    </blockquote>
    <UButton
      v-if="isSupported"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      color="neutral"
      variant="outline"
      size="sm"
      :aria-label="t('licence.reuseCreditCopy')"
      @click="copy(creditLine)"
    />
    <span class="sr-only" role="status">{{ copied ? t('licence.reuseCreditCopied') : '' }}</span>
  </div>
</template>
