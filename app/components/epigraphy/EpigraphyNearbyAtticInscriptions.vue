<script setup lang="ts">
  const props = defineProps<{ kind: 'site' | 'tracing'; id: number }>()

  const { t } = useI18n()
  const { inscriptions, isLoading } = useNearbyAtticInscriptions({
    kind: props.kind,
    id: () => props.id,
  })

  const titleKey = computed(() =>
    props.kind === 'tracing'
      ? 'atticInscriptions.nearby.titleTracing'
      : 'atticInscriptions.nearby.title',
  )
</script>

<template>
  <!-- Same "empty is ordinary, say nothing" instinct as `EpigraphyNearbyInscriptions` — AIO's
       corpus is Attica-only, so most sites and tracings outside that region have nothing here. -->
  <section v-if="isLoading || inscriptions.length > 0">
    <h2 class="eyebrow">{{ t(titleKey) }}</h2>
    <div v-if="isLoading" class="mt-2 space-y-2">
      <div class="h-4 w-3/4 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
      <div class="h-4 w-1/2 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
    </div>
    <ul v-else class="mt-2 space-y-1.5">
      <li v-for="inscription in inscriptions" :key="inscription.aioKey">
        <NuxtLink
          :to="`/inscriptions/attic/${inscription.aioKey}`"
          class="flex items-baseline justify-between gap-3 text-sm text-ink-700 underline-offset-2 hover:underline dark:text-paper-200"
        >
          <span class="truncate">{{ inscription.title }}</span>
          <span class="datum shrink-0">
            {{ t('atticInscriptions.nearby.distance', { metres: inscription.distanceMetres }) }}
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
