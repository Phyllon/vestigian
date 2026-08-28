<script setup lang="ts">
  import type { SiteEnrichment } from '#shared/types'

  /**
   * Prose borrowed from elsewhere, shown only when the match is certain.
   *
   * Three things this deliberately does not do. It renders nothing when there
   * is no match — most sites have none, and an empty state repeated across
   * thousands of records is noise, not information. It never presents the text
   * as the atlas's own: the attribution line is part of the content, not a
   * footnote, because the licence requires it and because a reader deserves to
   * know which words were written here and which were not. And it says how the
   * match was made, so "is this really the same place?" has an answer on the
   * screen rather than in a commit message.
   */
  const props = defineProps<{
    enrichment: SiteEnrichment | null
    isLoading: boolean
  }>()

  const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    nl: 'Dutch',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    fr: 'French',
  }

  const nameOf = (code: string): string => LANGUAGE_NAMES[code] ?? code.toUpperCase()

  /**
   * What to say about the language, if anything.
   *
   * Three cases, and the middle one is the reason this exists. Text already in
   * the interface language says nothing. Text a machine translated says so,
   * naming the language it came from — a translation of a CC BY-SA article is
   * still that article, and a reader should know a machine stood in between.
   * Text left in its own language says which, so nobody meets German prose
   * with no warning.
   */
  const languageNote = computed(() => {
    const enrichment = props.enrichment
    if (!enrichment) return null

    if (enrichment.isMachineTranslated) {
      return `Machine-translated from ${nameOf(enrichment.originalLanguage)}`
    }

    return enrichment.language === 'en' ? null : `In ${nameOf(enrichment.language)}`
  })

  const ROUTE_LABELS: Record<SiteEnrichment['matchedVia'], string> = {
    wikidata: 'Wikidata',
    pleiades: 'Pleiades',
    dare: 'the Digital Atlas of the Roman Empire',
  }

  const provenance = computed(() => {
    if (!props.enrichment) return ''
    const { matchedVia, matchedWithinMetres } = props.enrichment
    return `Matched through ${ROUTE_LABELS[matchedVia]}, ${matchedWithinMetres} m from the recorded position`
  })
</script>

<template>
  <section v-if="isLoading || enrichment">
    <h2 class="eyebrow">Elsewhere</h2>

    <!-- The same pulse the panel uses while the record itself loads. -->
    <div v-if="isLoading" class="mt-2 space-y-2" aria-hidden="true">
      <div class="h-4 w-full animate-pulse rounded bg-paper-200 dark:bg-night-700" />
      <div class="h-4 w-11/12 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
      <div class="h-4 w-2/3 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
    </div>

    <template v-else-if="enrichment">
      <p v-if="languageNote" class="eyebrow mt-2 text-ink-500 dark:text-paper-400">
        {{ languageNote }}
      </p>

      <p
        :lang="enrichment.language"
        class="mt-2 text-[0.95rem] leading-relaxed text-ink-700 dark:text-paper-200"
      >
        {{ enrichment.extract }}
      </p>

      <p class="datum mt-2" :title="provenance">
        {{ enrichment.source }} · {{ enrichment.licence }} · {{ enrichment.matchedWithinMetres }} m
      </p>

      <a
        :href="enrichment.articleUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-flex items-center gap-1.5 rounded-notebook border border-paper-300 px-2.5 py-1 text-xs text-ink-700 transition hover:border-oxide-600 hover:text-oxide-600 dark:border-night-600 dark:text-paper-200 dark:hover:border-oxide-300 dark:hover:text-oxide-300"
      >
        {{ enrichment.title }}
        <span class="sr-only">(opens in a new tab)</span>
        <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
      </a>
    </template>
  </section>
</template>
