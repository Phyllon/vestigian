<script setup lang="ts">
  const { t } = useI18n()

  definePageMeta({ layout: 'reading', middleware: 'moderator' })
  useHead({ title: t('moderation.contributorsPage.title') })
</script>

<template>
  <div>
    <header class="mb-6">
      <NuxtLink
        to="/moderation"
        class="eyebrow inline-flex items-center gap-1 hover:text-oxide-600"
      >
        <UIcon name="i-lucide-arrow-left" class="size-3" aria-hidden="true" />
        {{ t('moderation.contributorsPage.backToQueue') }}
      </NuxtLink>
      <h1 class="mt-2 text-3xl">{{ t('moderation.contributorsPage.title') }}</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        {{ t('moderation.contributorsPage.intro') }}
      </p>
    </header>

    <ModerationContributorTable />
  </div>
</template>
