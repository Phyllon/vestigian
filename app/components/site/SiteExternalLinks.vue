<script setup lang="ts">
import type { ExternalIdentifier } from '#shared/types'

defineProps<{ identifiers: ExternalIdentifier[] }>()

const SCHEME_LABELS: Record<string, string> = {
  pleiades: 'Pleiades',
  wikidata: 'Wikidata',
  vici: 'Vici.org',
  trismegistos: 'Trismegistos',
}

const labelFor = (scheme: string): string => SCHEME_LABELS[scheme] ?? scheme
</script>

<template>
  <section>
    <h2 class="eyebrow">Also recorded in</h2>
    <ul class="mt-2 flex flex-wrap gap-2">
      <li v-for="identifier in identifiers" :key="`${identifier.scheme}-${identifier.value}`">
        <a
          v-if="identifier.url"
          :href="identifier.url"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 rounded-notebook border border-paper-300 px-2.5 py-1 text-xs text-ink-700 transition hover:border-oxide-600 hover:text-oxide-600 dark:border-night-600 dark:text-paper-200 dark:hover:border-oxide-300 dark:hover:text-oxide-300"
        >
          {{ labelFor(identifier.scheme) }}
          <UIcon name="i-lucide-arrow-up-right" class="size-3" />
        </a>
        <span v-else class="datum">{{ labelFor(identifier.scheme) }} {{ identifier.value }}</span>
      </li>
    </ul>
  </section>
</template>
