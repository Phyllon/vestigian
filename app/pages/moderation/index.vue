<script setup lang="ts">
  definePageMeta({ layout: 'reading', middleware: 'moderator' })
  useHead({ title: 'Review queue' })
</script>

<template>
  <div>
    <header class="mb-6">
      <h1 class="text-3xl">Review queue</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        Contributions from accounts that have not yet earned automatic publishing.
      </p>
      <NuxtLink
        to="/moderation/contributors"
        class="mt-3 inline-flex items-center gap-1 text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        Contributors
        <UIcon name="i-lucide-arrow-right" class="size-3" />
      </NuxtLink>
    </header>

    <ModerationReviewQueue />
  </div>
</template>
