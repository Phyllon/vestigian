<script setup lang="ts">
  /**
   * "What can I do near here" — the queue this atlas never had.
   *
   * 61,273 records were imported and 82% of them have no photograph. Until this
   * page existed the application offered a map to browse and no way to find the
   * records that need somebody to stand in front of them, which is the one kind
   * of work a visitor can do that nobody at a desk can.
   *
   * Deliberately public. It is the best argument this project has for signing
   * up, and putting it behind an account would show it only to the people who
   * are already contributing.
   */
  import { mostValuableGap, type SiteGap } from '#shared/utils/completeness'
  import type { SiteCategory } from '#shared/types'

  interface NeedsWorkItem {
    slug: string
    title: string
    category: SiteCategory
    countryCode: string | null
    position: { lon: number; lat: number }
    distanceMetres: number
    score: number
    missing: SiteGap[]
  }

  const { t } = useI18n()
  const { status: locationStatus, position, toggleFollow } = useGeolocation()

  useHead({ title: t('nearby.title') })
  // A list keyed to wherever the reader happens to be standing is not something
  // a search engine can index meaningfully.
  useNoIndex()

  const radius = ref(10_000)
  const onlyPhotographs = ref(true)

  const query = computed(() =>
    position.value
      ? {
          lon: position.value.coords.lon,
          lat: position.value.coords.lat,
          radius: radius.value,
          missing: onlyPhotographs.value ? 'photograph' : undefined,
          limit: 20,
        }
      : {},
  )

  const {
    data,
    status: fetchStatus,
    execute,
  } = useFetch<{ items: NeedsWorkItem[] }>('/api/sites/needs-work', {
    server: false,
    query,
    // The endpoint requires a coordinate, so firing before one exists would be
    // a guaranteed 400.
    immediate: false,
    watch: [query],
  })

  /**
   * `immediate: false` and `watch` do not combine the way they read: `watch`
   * only *refreshes* a request that has already run once, so with nothing to
   * refresh the list stayed empty forever and no request was ever made. This
   * watcher fires the first one, and `watch: [query]` handles every later
   * change to the radius or the filter.
   */
  watch(
    () => Boolean(position.value),
    (located) => {
      if (located) void execute()
    },
    { immediate: true },
  )

  const items = computed(() => data.value?.items ?? [])

  const formatDistance = (metres: number): string =>
    metres < 1000
      ? t('nearby.distanceMetres', { metres: Math.round(metres) })
      : t('nearby.distanceKilometres', { km: (metres / 1000).toFixed(1) })

  /** The single most useful thing to do here, phrased as an instruction. */
  const describeAsk = (item: NeedsWorkItem): string => {
    const gap = mostValuableGap({ score: item.score, missing: item.missing })
    return gap ? t(`nearby.asks.${gap}`) : ''
  }

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('nearby.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('nearby.intro') }}
    </p>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <div v-if="!position" class="space-y-3">
        <p class="text-sm text-ink-600 dark:text-paper-300">{{ t('nearby.locationPrompt') }}</p>
        <UButton
          icon="i-lucide-locate-fixed"
          :loading="locationStatus === 'locating'"
          @click="toggleFollow"
        >
          {{ t('nearby.useMyLocation') }}
        </UButton>
        <p v-if="locationStatus === 'denied'" class="text-sm text-oxide-600 dark:text-oxide-300">
          {{ t('nearby.locationDenied') }}
        </p>
      </div>

      <div v-else class="space-y-4">
        <div class="flex flex-wrap items-end gap-4">
          <UFormField :label="t('nearby.radiusLabel')">
            <USelect
              v-model="radius"
              :items="[
                { label: t('nearby.radius5'), value: 5000 },
                { label: t('nearby.radius10'), value: 10000 },
                { label: t('nearby.radius25'), value: 25000 },
                { label: t('nearby.radius50'), value: 50000 },
              ]"
            />
          </UFormField>
          <UCheckbox v-model="onlyPhotographs" :label="t('nearby.onlyPhotographs')" />
        </div>

        <p v-if="fetchStatus === 'pending'" class="text-sm text-ink-500 dark:text-paper-400">
          {{ t('nearby.searching') }}
        </p>

        <p v-else-if="items.length === 0" class="text-sm text-ink-600 dark:text-paper-300">
          {{ t('nearby.nothingNearby') }}
        </p>

        <ul v-else class="space-y-3">
          <li
            v-for="item in items"
            :key="item.slug"
            class="rounded-notebook border border-paper-200 p-3 dark:border-night-700"
          >
            <div class="flex items-baseline justify-between gap-3">
              <NuxtLink
                :to="`/site/${item.slug}`"
                class="font-display text-lg text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
              >
                {{ item.title }}
              </NuxtLink>
              <span class="datum shrink-0">{{ formatDistance(item.distanceMetres) }}</span>
            </div>

            <p class="mt-1 text-sm text-ink-700 dark:text-paper-200">{{ describeAsk(item) }}</p>

            <ul class="mt-2 flex flex-wrap gap-1.5" :aria-label="t('nearby.missingAria')">
              <li
                v-for="gap in item.missing"
                :key="gap"
                class="eyebrow rounded-sm bg-paper-200 px-1.5 py-0.5 text-ink-600 dark:bg-night-700 dark:text-paper-300"
              >
                {{ t(`nearby.gaps.${gap}`) }}
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </section>
  </article>
</template>
