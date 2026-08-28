<script setup lang="ts">
  import type { NuxtError } from '#app'

  const props = defineProps<{ error: NuxtError }>()

  const heading = computed(() => {
    if (props.error.statusCode === 404) return 'Nothing recorded here'
    if (props.error.statusCode === 403) return 'Not yours to open'
    return 'Something gave way'
  })

  const explanation = computed(() => {
    if (props.error.statusCode === 404) return 'That page has no entry in the atlas.'
    if (props.error.statusCode === 403) return 'This page is for moderators.'
    return 'The page could not be loaded. Reloading usually settles it.'
  })

  /**
   * `error.vue` replaces `app.vue` rather than rendering inside it, so nothing
   * here inherits the head set there. Without this the error page went out with
   * no `<title>` and no `lang` on `<html>` — the two things the W3C checker
   * reports first, and the second of which leaves a screen reader guessing at
   * the pronunciation of the only text on the page.
   */
  useHead({
    htmlAttrs: { lang: 'en' },
    title: computed(() => `${heading.value} · Vestigia`),
  })
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-paper-100 px-6 dark:bg-night-900">
    <div class="leaf max-w-md p-8">
      <p class="eyebrow">Error {{ error.statusCode }}</p>
      <h1 class="mt-2 text-2xl">{{ heading }}</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">{{ explanation }}</p>
      <UButton class="mt-5" color="primary" @click="clearError({ redirect: '/' })">
        Back to the map
      </UButton>
    </div>
  </main>
</template>
