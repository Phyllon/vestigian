<script setup lang="ts">
  /**
   * A standalone IIIF deep-zoom viewer, not a fifth basemap.
   *
   * The Tabula Peutingeriana is a schematic route diagram — 113,664×6,144px,
   * 18.5:1 — not a geographically accurate map. Draping it as a MapLibre
   * raster source under real site markers the way DARE or the satellite view
   * are would misplace every road relative to the coordinates it sits beside,
   * so it gets its own page and its own viewer instead.
   *
   * The actual OpenSeadragon viewer lives in
   * `TabulaPeutingerianaViewer.client.vue` — see that component's docstring
   * for why it has to be a `.client.vue` component rather than logic inlined
   * here, and for the two hydration/bundling bugs already found in it.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('tabulaPeutingeriana.title') })
  useSeoMeta({ description: t('tabulaPeutingeriana.intro') })
  useCanonicalUrl()
  useSocialMeta({
    title: t('tabulaPeutingeriana.title'),
    description: t('tabulaPeutingeriana.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('tabulaPeutingeriana.title') }}
    </h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('tabulaPeutingeriana.intro') }}
    </p>

    <p class="mt-2 text-sm leading-relaxed text-ink-500 dark:text-paper-400">
      {{ t('tabulaPeutingeriana.distortionNote') }}
    </p>

    <!-- Breaks out of the reading layout's max-w-3xl prose column: a deep-zoom
         viewer for an 18.5:1 image needs real width, not a column meant for text. -->
    <div class="relative left-1/2 right-1/2 mx-[-50vw] mt-6 w-screen px-4 sm:px-6">
      <!--
        Explicit ClientOnly, not just the .client.vue suffix on its own: this
        viewer is the page's default, always-visible content (unlike the
        Marcus Aurelius viewer, which only ever mounts after a tab click and
        so has no server-rendered placeholder to hydrate against in the first
        place). Left un-wrapped, the server-rendered placeholder never picked
        up a real client-side mount and the div stayed permanently empty —
        found by checking its innerHTML in a real browser, not by assuming
        the .client.vue suffix alone was sufficient.
      -->
      <TabulaPeutingerianaViewer />
    </div>

    <p class="mt-6 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
      {{ t('tabulaPeutingeriana.attribution') }}
      <a
        href="https://omnesviae.org/tabula"
        target="_blank"
        rel="noopener"
        class="underline hover:text-oxide-600 dark:hover:text-oxide-300"
      >
        omnesviae.org
      </a>
    </p>
  </article>
</template>
