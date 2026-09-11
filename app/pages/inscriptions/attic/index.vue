<script setup lang="ts">
  import type { AtticInscriptionSummary } from '#shared/types'

  /**
   * Attic Inscriptions Online — a second, smaller corpus alongside
   * `/inscriptions`'s EDH mirror (`.claude/rules/epigraphy.md`): Classical
   * and Hellenistic Athenian decrees, not Roman-imperial epigraphy, so a
   * separate browse/detail pair rather than a facet on the same page.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('atticInscriptions.title') })
  useSeoMeta({ description: t('atticInscriptions.intro') })
  useCanonicalUrl()
  useSocialMeta({
    title: t('atticInscriptions.title'),
    description: t('atticInscriptions.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })

  const filters = ref(emptyAtticInscriptionBrowseFilters())
  const { items, hasMore, isLoading, load, loadMore } = useAtticInscriptionBrowse(filters)

  onMounted(() => {
    load(true)
  })

  // 'all', not '' — see `useInscriptionBrowse.ts`'s identical note on why
  // Reka UI's Select primitive cannot take an empty-string item value.
  const ANY_VALUE = 'all'

  // The four most common values across the full 3,412-record corpus
  // (Stele 1,509, Base 769, Plaque 203, Altar 163) — checked after the full
  // import ran, not guessed from an early sample, which had 'Block' (33
  // records) outranking 'Altar' (163) in the options list.
  const monumentOptions = computed(() => [
    { label: t('atticInscriptions.filters.anyMonumentType'), value: ANY_VALUE },
    { label: t('atticInscriptions.monumentTypes.stele'), value: 'Stele' },
    { label: t('atticInscriptions.monumentTypes.base'), value: 'Base' },
    { label: t('atticInscriptions.monumentTypes.plaque'), value: 'Plaque' },
    { label: t('atticInscriptions.monumentTypes.altar'), value: 'Altar' },
  ])

  const periodFor = (item: AtticInscriptionSummary): string =>
    item.dateText ?? formatPeriod(item.notBefore, item.notAfter, t)
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('atticInscriptions.title') }}
    </h1>
    <p class="mt-4 max-w-2xl text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('atticInscriptions.intro') }}
    </p>
    <p class="datum mt-2">{{ t('atticInscriptions.credit') }}</p>
    <NuxtLink to="/inscriptions" class="datum mt-1 inline-block underline-offset-2 hover:underline">
      {{ t('atticInscriptions.backToEdh') }}
    </NuxtLink>

    <section class="mt-10">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('atticInscriptions.browse.title') }}
      </h2>

      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <UFormField :label="t('atticInscriptions.filters.monumentType')">
          <USelect v-model="filters.monumentType" :items="monumentOptions" class="w-full" />
        </UFormField>
        <UFormField :label="t('atticInscriptions.filters.yearFrom')">
          <UInput v-model="filters.yearFrom" type="number" class="w-full" />
        </UFormField>
        <UFormField :label="t('atticInscriptions.filters.yearTo')">
          <UInput v-model="filters.yearTo" type="number" class="w-full" />
        </UFormField>
      </div>

      <ul class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="item in items" :key="item.aioKey">
          <NuxtLink
            :to="`/inscriptions/attic/${item.aioKey}`"
            class="leaf block h-full p-4 transition hover:border-oxide-600 dark:hover:border-oxide-300"
          >
            <p class="eyebrow">{{ item.monumentType ?? item.inscriptionType }}</p>
            <p class="mt-1 line-clamp-2 text-sm font-medium text-ink-900 dark:text-paper-100">
              {{ item.title }}
            </p>
            <p v-if="item.primarySource" class="datum mt-1 truncate">{{ item.primarySource }}</p>
            <p class="datum mt-1">{{ periodFor(item) }}</p>
          </NuxtLink>
        </li>
      </ul>

      <p v-if="!isLoading && items.length === 0" class="datum mt-6">
        {{ t('atticInscriptions.browse.empty') }}
      </p>

      <div class="mt-6 flex justify-center">
        <UButton
          v-if="hasMore"
          :loading="isLoading"
          variant="outline"
          color="neutral"
          @click="loadMore"
        >
          {{ t('atticInscriptions.browse.loadMore') }}
        </UButton>
      </div>
    </section>
  </article>
</template>
