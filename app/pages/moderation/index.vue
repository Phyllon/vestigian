<script setup lang="ts">
  const { t } = useI18n()

  definePageMeta({ layout: 'reading', middleware: 'moderator' })
  useHead({ title: t('moderation.queuePage.title') })
  useNoIndex()
</script>

<template>
  <div>
    <header class="mb-6">
      <h1 class="text-3xl">{{ t('moderation.queuePage.title') }}</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        {{ t('moderation.queuePage.intro') }}
      </p>
    </header>

    <ModerationReviewQueue />
  </div>
</template>
