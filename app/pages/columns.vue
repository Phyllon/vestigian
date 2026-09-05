<script setup lang="ts">
  /**
   * Detailed relief imagery for two Roman columns, each borrowed source used
   * the way its own licence and shape actually call for — not one uniform
   * treatment:
   *
   * Trajan's Column: Cichorius's 1896–1900 plates, mirrored from Wikimedia
   * Commons into this project's own storage (`ColumnTrajanGallery`) — a
   * bounded, individually-licensed file set, the same shape as the DARE and
   * satellite basemap mirrors.
   *
   * The Column of Marcus Aurelius: Petersen, Domaszewski & Calderini's 1896
   * plates, served live via Heidelberg University Library's IIIF API
   * (`ColumnMarcusAureliusViewer`) — one scanned book, not mirrored, the
   * same reasoning that keeps the Tabula Peutingeriana manuscript in its own
   * live IIIF viewer rather than copied into storage.
   *
   * Not reached from the basemap switcher's antiquity group the way the
   * Tabula Peutingeriana viewer is — that group is specifically about
   * alternate ways of viewing *the map*, and this is monument-specific
   * reference material with no geographic-view angle. Reached from the app
   * menu instead (`AppMenu.vue`).
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('columns.title') })
  useSeoMeta({ description: t('columns.intro') })
  useCanonicalUrl()
  useSocialMeta({
    title: t('columns.title'),
    description: t('columns.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })

  const tabs = [
    { label: t('columns.trajan.tabLabel'), slot: 'trajan' as const, value: 'trajan' },
    {
      label: t('columns.marcusAurelius.tabLabel'),
      slot: 'marcus-aurelius' as const,
      value: 'marcus-aurelius',
    },
  ]
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('columns.title') }}
    </h1>
    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('columns.intro') }}
    </p>

    <UTabs :items="tabs" class="mt-8" default-value="trajan">
      <template #trajan>
        <p class="mb-4 text-sm leading-relaxed text-ink-500 dark:text-paper-400">
          {{ t('columns.trajan.intro') }}
        </p>
        <ColumnsColumnTrajanGallery />
      </template>

      <template #marcus-aurelius>
        <p class="mb-4 text-sm leading-relaxed text-ink-500 dark:text-paper-400">
          {{ t('columns.marcusAurelius.intro') }}
        </p>
        <ColumnsColumnMarcusAureliusViewer />
      </template>
    </UTabs>
  </article>
</template>
