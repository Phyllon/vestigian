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
      <NuxtLink
        to="/moderation/contributors"
        class="mt-3 inline-flex items-center gap-1 text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        {{ t('moderation.queuePage.contributorsLink') }}
        <UIcon name="i-lucide-arrow-right" class="size-3" aria-hidden="true" />
      </NuxtLink>
    </header>

    <ModerationReviewQueue />
  </div>
</template>
