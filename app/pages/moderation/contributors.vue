<script setup lang="ts">
  definePageMeta({ layout: 'reading', middleware: 'moderator' })
  useHead({ title: 'Contributors' })
</script>

<template>
  <div>
    <header class="mb-6">
      <NuxtLink
        to="/moderation"
        class="eyebrow inline-flex items-center gap-1 hover:text-oxide-600"
      >
        <UIcon name="i-lucide-arrow-left" class="size-3" aria-hidden="true" />
        Review queue
      </NuxtLink>
      <h1 class="mt-2 text-3xl">Contributors</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        Suspending publishing keeps a contributor's record intact — restoring it returns them to
        exactly where they were.
      </p>
    </header>

    <ModerationContributorTable />
  </div>
</template>
