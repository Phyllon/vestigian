<script setup lang="ts">
  /**
   * Terms differ per layer, so this page states each one rather than a single
   * blanket label. Contributed text/metadata is genuinely reusable, including
   * commercially — it would be inaccurate to call the whole site
   * "non-commercial" the way the DARE basemap specifically is, per its own
   * NC-credited source layers (see CLAUDE.md's antiquity-basemaps section).
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('licence.title') })
  useSeoMeta({ description: t('licence.intro') })
  useCanonicalUrl()

  useSocialMeta({
    title: t('licence.title'),
    description: t('licence.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('licence.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('licence.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.recordsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.recordsBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.imagesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.imagesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.barringtonHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.barringtonBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.dareHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.dareBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.satelliteHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.satelliteBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.limesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.limesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.overlaysHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.overlaysIntro') }}
      </p>
      <ul class="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        <li>{{ t('licence.overlayBattles') }}</li>
        <li>{{ t('licence.overlayPorts') }}</li>
        <li>{{ t('licence.overlayRoutes') }}</li>
        <li>{{ t('licence.overlayMinorFeatures') }}</li>
        <li>{{ t('licence.overlayCoinHoards') }}</li>
        <li>{{ t('licence.overlayEmpireExtents') }}</li>
      </ul>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.columnReliefHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.columnReliefBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.placeNamesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.placeNamesBody') }}
      </p>
    </section>

    <!--
      This atlas takes from the open-data commons; the two feeds below are what
      it gives back. Listed on the licence page rather than hidden in the API
      documentation because reuse terms and the means of reuse belong together.
    -->
    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.reuseHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseBody') }}
      </p>
      <ul class="mt-3 space-y-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        <li>
          <a
            href="/api/data/sites.geojson"
            class="font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
            >/api/data/sites.geojson</a
          >
          — {{ t('licence.reuseGeojson') }}
        </li>
        <li>
          <a
            href="/api/data/sites.lp.json"
            class="font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
            >/api/data/sites.lp.json</a
          >
          — {{ t('licence.reuseLinkedPlaces') }}
        </li>
      </ul>
    </section>
  </article>
</template>
