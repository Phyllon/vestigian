<script setup lang="ts">
  import type { ExternalIdentifier } from '#shared/types'

  const props = defineProps<{ identifiers: ExternalIdentifier[] }>()

  const { t, te } = useI18n()

  const labelFor = (scheme: string): string =>
    te(`siteExternalLinks.schemes.${scheme}`) ? t(`siteExternalLinks.schemes.${scheme}`) : scheme

  const verifiedTitleFor = (identifier: ExternalIdentifier): string =>
    t('siteExternalLinks.verifiedTitle', {
      source: labelFor(identifier.verifiedVia ?? ''),
      metres: identifier.verifiedDistanceMetres ?? 0,
    })

  const verifiedCount = computed(
    () => props.identifiers.filter((identifier) => identifier.verifiedVia).length,
  )
</script>

<template>
  <section>
    <h2 class="eyebrow">{{ t('siteExternalLinks.title') }}</h2>
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
          <span class="sr-only">{{ t('siteExternalLinks.opensNewTab') }}</span>
          <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
          <!--
            Verdigris, not a new colour: this project's own token for an
            approved/confirmed state. Absence means unchecked, not wrong, so
            an unverified link carries no negative marker of its own.
          -->
          <UIcon
            v-if="identifier.verifiedVia"
            name="i-lucide-badge-check"
            class="size-3 text-verdigris-600 dark:text-verdigris-400"
            :aria-label="verifiedTitleFor(identifier)"
            :title="verifiedTitleFor(identifier)"
          />
        </a>
        <span v-else class="datum">{{ labelFor(identifier.scheme) }} {{ identifier.value }}</span>
      </li>
    </ul>
    <p v-if="verifiedCount > 0" class="datum mt-2">
      {{
        t('siteExternalLinks.verifiedSummary', { count: verifiedCount, total: identifiers.length })
      }}
    </p>
  </section>
</template>
