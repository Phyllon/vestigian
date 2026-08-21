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
</script>

<template>
  <div class="grid min-h-dvh place-items-center bg-paper-100 px-6 dark:bg-night-900">
    <div class="leaf leaf-margin max-w-md py-8 pr-8">
      <p class="eyebrow">Error {{ error.statusCode }}</p>
      <h1 class="mt-2 text-2xl">{{ heading }}</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">{{ explanation }}</p>
      <UButton class="mt-5" color="primary" @click="clearError({ redirect: '/' })">
        Back to the map
      </UButton>
    </div>
  </div>
</template>
