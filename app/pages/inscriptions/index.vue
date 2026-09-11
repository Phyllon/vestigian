<script setup lang="ts">
  import type { InscriptionFormulaEntry, InscriptionSummary } from '#shared/types'

  /**
   * The explorative reference-menu entry alongside `/columns` and
   * `/tabula-peutingeriana` — mirrored EDH inscriptions, not contributed
   * records (`.claude/rules/epigraphy.md`). A curated strip first, then
   * facet browsing, then the formulary — one destination, not three thin
   * ones, the same instinct `/columns` follows with its two monument tabs.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('epigraphy.title') })
  useSeoMeta({ description: t('epigraphy.intro') })
  useCanonicalUrl()
  useSocialMeta({
    title: t('epigraphy.title'),
    description: t('epigraphy.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })

  const filters = ref(emptyInscriptionBrowseFilters())
  const { items, hasMore, isLoading, load, loadMore } = useInscriptionBrowse(filters)

  const { data: notable } = await useAsyncData<InscriptionSummary[]>(
    'epigraphy-notable',
    () =>
      $fetch<{ items: InscriptionSummary[] }>('/api/inscriptions', {
        query: { decoratedOnly: true, limit: 6 },
      }).then((response) => response.items),
    { default: () => [] },
  )

  const { data: formulary } = await useAsyncData<InscriptionFormulaEntry[]>(
    'epigraphy-formulary',
    () => $fetch<InscriptionFormulaEntry[]>('/api/inscriptions/formulary'),
    { default: () => [] },
  )

  onMounted(() => {
    load(true)
  })

  // 'all', not '' — Reka UI's underlying Select primitive reserves an empty
  // string internally for "nothing selected" and breaks (a hard render
  // crash, not just a mismatch) if an item actually uses it as a value.
  // Confirmed live: this is exactly what turned "Any type"/"Any language"
  // into a page-crashing "Something gave way" on `/inscriptions`.
  const ANY_VALUE = 'all'

  const typeOptions = computed(() => [
    { label: t('epigraphy.filters.anyType'), value: ANY_VALUE },
    { label: t('epigraphy.types.funerary'), value: 'funerary' },
    { label: t('epigraphy.types.votive'), value: 'votive' },
    { label: t('epigraphy.types.honorific'), value: 'honorific' },
    { label: t('epigraphy.types.building'), value: 'building' },
    { label: t('epigraphy.types.milestone'), value: 'milestone' },
  ])

  const languageOptions = computed(() => [
    { label: t('epigraphy.filters.anyLanguage'), value: ANY_VALUE },
    { label: t('epigraphy.languages.la'), value: 'la' },
    { label: t('epigraphy.languages.grc'), value: 'grc' },
  ])

  const typeLabel = (value: string | null): string =>
    value && t(`epigraphy.types.${value}`) !== `epigraphy.types.${value}`
      ? t(`epigraphy.types.${value}`)
      : (value ?? '')

  const periodFor = (item: InscriptionSummary): string =>
    formatPeriod(item.notBefore, item.notAfter, t)
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('epigraphy.title') }}
    </h1>
    <p class="mt-4 max-w-2xl text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('epigraphy.intro') }}
    </p>
    <p class="datum mt-2">{{ t('epigraphy.credit') }}</p>

    <section v-if="notable.length > 0" class="mt-10">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('epigraphy.notable.title') }}
      </h2>
      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="item in notable"
          :key="item.edhId"
          :to="`/inscriptions/${item.edhId}`"
          class="leaf block p-4 transition hover:border-oxide-600 dark:hover:border-oxide-300"
        >
          <p class="eyebrow">{{ typeLabel(item.inscriptionType) }}</p>
          <p class="mt-1 truncate text-sm font-medium text-ink-900 dark:text-paper-100">
            {{ item.title }}
          </p>
          <p class="datum mt-1">{{ periodFor(item) }}</p>
        </NuxtLink>
      </div>
    </section>

    <section class="mt-10">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('epigraphy.browse.title') }}
      </h2>

      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <UFormField :label="t('epigraphy.filters.type')">
          <USelect v-model="filters.type" :items="typeOptions" class="w-full" />
        </UFormField>
        <UFormField :label="t('epigraphy.filters.language')">
          <USelect v-model="filters.language" :items="languageOptions" class="w-full" />
        </UFormField>
        <UFormField :label="t('epigraphy.filters.yearFrom')">
          <UInput v-model="filters.yearFrom" type="number" class="w-full" />
        </UFormField>
        <UFormField :label="t('epigraphy.filters.yearTo')">
          <UInput v-model="filters.yearTo" type="number" class="w-full" />
        </UFormField>
      </div>
      <UCheckbox
        v-model="filters.decoratedOnly"
        :label="t('epigraphy.filters.decoratedOnly')"
        class="mt-3"
      />

      <ul class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="item in items" :key="item.edhId">
          <NuxtLink
            :to="`/inscriptions/${item.edhId}`"
            class="leaf block h-full p-4 transition hover:border-oxide-600 dark:hover:border-oxide-300"
          >
            <p class="eyebrow">{{ typeLabel(item.inscriptionType) }}</p>
            <p class="mt-1 line-clamp-2 text-sm font-medium text-ink-900 dark:text-paper-100">
              {{ item.title }}
            </p>
            <p v-if="item.material" class="datum mt-1 truncate">{{ item.material }}</p>
            <p class="datum mt-1">{{ periodFor(item) }}</p>
          </NuxtLink>
        </li>
      </ul>

      <p v-if="!isLoading && items.length === 0" class="datum mt-6">
        {{ t('epigraphy.browse.empty') }}
      </p>

      <div class="mt-6 flex justify-center">
        <UButton
          v-if="hasMore"
          :loading="isLoading"
          variant="outline"
          color="neutral"
          @click="loadMore"
        >
          {{ t('epigraphy.browse.loadMore') }}
        </UButton>
      </div>
    </section>

    <section v-if="formulary.length > 0" class="mt-10">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('epigraphy.formulary.title') }}
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-paper-400">
        {{ t('epigraphy.formulary.intro') }}
      </p>
      <ul class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <li
          v-for="entry in formulary"
          :key="`${entry.abbr}-${entry.expansion}`"
          class="flex items-center justify-between gap-3 rounded-notebook border border-paper-300 px-3 py-2 dark:border-night-600"
        >
          <span class="flex items-baseline gap-1 font-mono text-sm">
            <span class="font-semibold text-oxide-600 dark:text-oxide-300">{{ entry.abbr }}</span>
            <span class="text-ink-700 dark:text-paper-200">({{ entry.expansion }})</span>
          </span>
          <NuxtLink
            :to="`/inscriptions/${entry.exampleEdhId}`"
            class="datum shrink-0 underline-offset-2 hover:underline"
          >
            {{ t('epigraphy.formulary.count', { count: entry.count }) }}
          </NuxtLink>
        </li>
      </ul>
    </section>
  </article>
</template>
