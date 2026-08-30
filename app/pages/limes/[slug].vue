<script setup lang="ts">
  import type { LimesInstallation, LimesSectorDetail } from '#shared/types'

  /**
   * One stretch of frontier, and everything recorded along it in order.
   *
   * The roll is the point of the page. On the map it is a scrolling list beside
   * a moving camera; here it is a document — linkable, citable, and readable
   * from top to bottom the way the frontier was walked.
   */
  const route = useRoute()
  const slug = computed(() => String(route.params.slug))

  const { data: sector } = await useFetch<LimesSectorDetail>(
    () => `/api/limes/sectors/${slug.value}`,
  )

  if (!sector.value) {
    throw createError({ statusCode: 404, statusMessage: 'No such stretch of frontier.' })
  }

  /**
   * Interleaved for reading, separate in the response and separately labelled
   * below. See the same note in `LimesPanel`: ordering by distance along the
   * frontier is what makes this an itinerary rather than two lists.
   */
  const roll = computed<LimesInstallation[]>(() =>
    [...(sector.value?.roll.records ?? []), ...(sector.value?.roll.references ?? [])].sort(
      (a, b) => a.offsetMetres - b.offsetMetres,
    ),
  )

  useHead({ title: () => sector.value?.name ?? 'The limes' })
  useSeoMeta({ description: () => sector.value?.summary ?? undefined })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article v-if="sector">
    <nav aria-label="Breadcrumb">
      <NuxtLink
        to="/limes"
        class="text-sm text-ink-500 underline underline-offset-2 dark:text-paper-400"
      >
        The limes
      </NuxtLink>
    </nav>

    <h1 class="mt-2 font-display text-3xl text-ink-900 dark:text-paper-100">{{ sector.name }}</h1>
    <p v-if="sector.latinName" class="font-mono text-sm text-ink-500 dark:text-paper-400">
      {{ sector.latinName }}
    </p>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ sector.summary }}
    </p>

    <dl class="mt-5 flex flex-wrap gap-x-8 gap-y-2 font-mono text-sm">
      <div>
        <dt class="eyebrow">Length</dt>
        <dd class="text-ink-800 dark:text-paper-200">
          {{ formatFrontierLength(sector.lengthMetres) }}
        </dd>
      </div>
      <div>
        <dt class="eyebrow">In use</dt>
        <dd class="text-ink-800 dark:text-paper-200">
          {{ formatFrontierYears(sector.minYear, sector.maxYear) }}
        </dd>
      </div>
      <div>
        <dt class="eyebrow">Recorded on it</dt>
        <dd class="text-ink-800 dark:text-paper-200">{{ roll.length }}</dd>
      </div>
      <div v-if="sector.pleiadesId">
        <dt class="eyebrow">Pleiades</dt>
        <dd>
          <a
            :href="`https://pleiades.stoa.org/places/${sector.pleiadesId}`"
            rel="noopener"
            class="text-oxide-700 underline underline-offset-2 dark:text-oxide-300"
          >
            {{ sector.pleiadesId }}
          </a>
        </dd>
      </div>
    </dl>

    <h2 class="mt-10 font-display text-xl text-ink-900 dark:text-paper-100">
      Along the line, west to east
    </h2>

    <p v-if="roll.length === 0" class="mt-3 text-sm text-ink-500 dark:text-paper-400">
      Nothing is recorded on this stretch yet.
    </p>

    <ol v-else class="mt-4">
      <li
        v-for="installation in roll"
        :key="`${installation.slug ?? 'p'}-${installation.id}`"
        class="flex items-baseline gap-3 border-t border-paper-200 py-2 last:border-b dark:border-night-700"
      >
        <span class="w-24 shrink-0 font-mono text-xs text-ink-500 dark:text-paper-400">
          {{ formatOffset(installation.offsetMetres) }}
        </span>

        <span class="min-w-0 flex-1">
          <NuxtLink
            v-if="installation.slug"
            :to="`/site/${installation.slug}`"
            class="text-ink-900 underline underline-offset-2 dark:text-paper-100"
          >
            {{ installation.title }}
          </NuxtLink>
          <a
            v-else-if="installation.pleiadesId"
            :href="`https://pleiades.stoa.org/places/${installation.pleiadesId}`"
            rel="noopener"
            class="text-ink-600 underline underline-offset-2 dark:text-paper-300"
          >
            {{ installation.title }}
          </a>
          <span v-else class="text-ink-600 dark:text-paper-300">{{ installation.title }}</span>
        </span>

        <span class="shrink-0 font-mono text-xs text-ink-500 dark:text-paper-400">
          {{ installation.mark ? LIMES_MARK_LABELS[installation.mark] : 'Fortification' }}
        </span>
      </li>
    </ol>

    <!--
      Named separately because they are licensed separately, and because a
      reader deserves to know that half of this list is other people's record
      rather than this atlas's.
    -->
    <p class="mt-8 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
      {{ sector.roll.records.length }} contributed records —
      {{ sector.roll.recordsAttribution }}.<br />
      {{ sector.roll.references.length }} referenced places —
      {{ sector.roll.referencesAttribution }}.
    </p>
  </article>
</template>
