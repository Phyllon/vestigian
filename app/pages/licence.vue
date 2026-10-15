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

  /** The query schema of `/api/data/sites.geojson` and `/api/data/sites.lp.json`, as one list. */
  const feedParameters = [
    { name: 'bbox', hint: 'licence.reuseParamBbox' },
    { name: 'category', hint: 'licence.reuseParamCategory' },
    { name: 'limit', hint: 'licence.reuseParamLimit' },
    { name: 'offset', hint: 'licence.reuseParamOffset' },
    { name: 'dated', hint: 'licence.reuseParamDated' },
  ]

  const exampleQuery = 'bbox=6,50,8,52&category=fortification&limit=100'
  const exampleUrls = [
    `${base}/api/data/sites.geojson?${exampleQuery}&offset=100`,
    `${base}/api/data/sites.lp.json?${exampleQuery}&offset=100`,
  ]

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
  <article class="relative">
    <UiPageContents />

    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('licence.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('licence.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="records" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.recordsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.recordsBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="images" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.imagesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.imagesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="modern-map" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.modernMapHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.modernMapBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="elevation" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.elevationHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.elevationBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="barrington" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.barringtonHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.barringtonBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="dare" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.dareHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.dareBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="satellite" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.satelliteHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.satelliteBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="limes" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.limesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.limesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="overlays" class="font-display text-xl text-ink-900 dark:text-paper-100">
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
        <li>{{ t('licence.overlayInscriptions') }}</li>
        <li>{{ t('licence.overlayAtticInscriptions') }}</li>
        <li>{{ t('licence.overlayTabulaPeutingeriana') }}</li>
        <li>{{ t('licence.overlayRomanRoads') }}</li>
        <li>{{ t('licence.overlayMonuments') }}</li>
        <li>{{ t('licence.overlayMints') }}</li>
        <li>{{ t('licence.overlayIsicily') }}</li>
        <li>{{ t('licence.overlayPolities') }}</li>
        <li>{{ t('licence.overlayHillforts') }}</li>
        <li>
          <i18n-t keypath="licence.overlaySurveySites" scope="global">
            <template #survey>
              <a
                href="https://survey.jensineandresen.com"
                target="_blank"
                rel="noopener noreferrer"
                class="text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
              >
                Ancient Sites and Monuments Survey
              </a>
            </template>
          </i18n-t>
        </li>
        <li>{{ t('licence.overlayRoadAudit') }}</li>
      </ul>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="column-relief" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.columnReliefHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.columnReliefBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="place-names" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.placeNamesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.placeNamesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="enrichment" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.enrichmentHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.enrichmentBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="icons" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.iconsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.iconsBody') }}
      </p>
    </section>

    <!--
      This atlas takes from the open-data commons; the two feeds below are what
      it gives back. Listed on the licence page rather than hidden in the API
      documentation because reuse terms and the means of reuse belong together.
    -->
    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="reuse" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.reuseHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseBody') }}
      </p>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseNotIncluded') }}
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
        <li>
          <a
            href="/api/survey-sites/sites.geojson"
            class="font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
            >/api/survey-sites/sites.geojson</a
          >
          — {{ t('licence.reuseSurveyFeed') }}
        </li>
      </ul>

      <h3 class="mt-5 font-display text-lg text-ink-900 dark:text-paper-100">
        {{ t('licence.reuseParamsHeading') }}
      </h3>
      <p class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseParamsIntro') }}
      </p>
      <dl
        class="mt-3 grid grid-cols-1 gap-y-1 text-sm leading-relaxed text-ink-700 sm:grid-cols-[max-content_1fr] sm:gap-x-4 sm:gap-y-3 dark:text-paper-200"
      >
        <template v-for="parameter in feedParameters" :key="parameter.name">
          <dt class="mt-2 font-mono text-ink-900 sm:mt-0 dark:text-paper-100">
            {{ parameter.name }}
          </dt>
          <dd>{{ t(parameter.hint) }}</dd>
        </template>
      </dl>

      <p class="mt-4 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseExampleLabel') }}
      </p>
      <ul class="mt-1 space-y-1 text-xs">
        <li v-for="url in exampleUrls" :key="url">
          <a
            :href="url"
            class="block break-all font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
            >{{ url }}</a
          >
        </li>
      </ul>
    </section>

    <section class="mt-10 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="credit" class="scroll-mt-20 font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.reuseCreditHeading') }}
      </h2>
      <UiCreditLine class="mt-2" />
    </section>
  </article>
</template>
