<script setup lang="ts">
  /**
   * Terms differ per layer, so this page states each one rather than a single
   * blanket label. Contributed text/metadata is genuinely reusable, including
   * commercially — it would be inaccurate to call the whole site
   * "non-commercial" the way the DARE basemap specifically is, per its own
   * NC-credited source layers (see CLAUDE.md's antiquity-basemaps section).
   */
  import { ODBL_FEED_LAYERS, odblFeedPath } from '#shared/utils/odbl-feeds'

  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  /**
   * The parameters of the feeds, as one list: `bbox`, `limit` and `offset` are
   * common to all of them; the rest say in their own hint which feeds take them.
   */
  const feedParameters = [
    { name: 'bbox', hint: 'licence.reuseParamBbox' },
    { name: 'category', hint: 'licence.reuseParamCategory' },
    { name: 'limit', hint: 'licence.reuseParamLimit' },
    { name: 'offset', hint: 'licence.reuseParamOffset' },
    { name: 'dated', hint: 'licence.reuseParamDated' },
    { name: 'kind', hint: 'licence.reuseParamKind' },
    { name: 'source', hint: 'licence.reuseParamSource' },
  ]

  const exampleQuery = 'bbox=6,50,8,52&category=fortification&limit=100'
  const exampleUrls = [
    `${base}/api/data/sites.geojson?${exampleQuery}&offset=100`,
    `${base}/api/data/sites.lp.json?${exampleQuery}&offset=100`,
    `${base}/api/data/sites.ttl?${exampleQuery}&offset=100`,
  ]
  const odblExampleUrls = [
    `${base}/api/odbl/awmc-lines.geojson?bbox=6,50,8,52&kind=road&limit=100`,
    `${base}/api/odbl/limes.ttl?source=osm&limit=100`,
  ]

  /**
   * The ODbL feeds, in the order they are listed. The layer ids come from
   * `shared/utils/odbl-feeds.ts`, which the endpoint reads too, so the page and
   * the route cannot disagree about what exists; `i18nKey` is the camelCase of
   * each id because a hyphen is not safe in a message path.
   */
  const odblFeeds = ODBL_FEED_LAYERS.map((layer) => ({
    layer,
    i18nKey: `licence.reuseLayers.${layer.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())}`,
    geojsonPath: odblFeedPath(layer, 'geojson'),
    turtlePath: odblFeedPath(layer, 'ttl'),
  }))

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
      This atlas takes from the open-data commons; the feeds below are what it
      gives back, grouped by the licence that governs them. Listed on the licence
      page rather than hidden in the API documentation because reuse terms and
      the means of reuse belong together. For the ODbL group it is also a duty:
      ODbL §4.6 asks that an adapted database be offered in a machine-readable form.
    -->
    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="reuse" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.reuseHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseBody') }}
      </p>

      <!-- One block per licence, so the terms a feed is under sit directly above it. -->
      <section class="leaf mt-4 p-4" aria-labelledby="reuse-shared">
        <h3 id="reuse-shared" class="font-display text-lg text-ink-900 dark:text-paper-100">
          {{ t('licence.reuseGroupSharedHeading') }}
        </h3>
        <p class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
          {{ t('licence.reuseGroupSharedBody') }}
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
              href="/api/data/sites.ttl"
              class="font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
              >/api/data/sites.ttl</a
            >
            — {{ t('licence.reuseTurtle') }}
          </li>
        </ul>
      </section>

      <section class="leaf mt-4 p-4" aria-labelledby="reuse-odbl">
        <h3 id="reuse-odbl" class="font-display text-lg text-ink-900 dark:text-paper-100">
          {{ t('licence.reuseGroupOdblHeading') }}
        </h3>
        <p class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
          {{ t('licence.reuseGroupOdblBody') }}
        </p>
        <ul class="mt-3 space-y-3 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
          <li v-for="feed in odblFeeds" :key="feed.layer">
            {{ t(feed.i18nKey) }}
            <span class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
              <a
                :href="feed.geojsonPath"
                class="font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
                >{{ feed.geojsonPath }}</a
              >
              <a
                :href="feed.turtlePath"
                class="font-mono text-ink-900 underline decoration-paper-400 underline-offset-2 dark:text-paper-100"
                >{{ feed.turtlePath }}</a
              >
            </span>
          </li>
        </ul>
      </section>

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
      <p class="mt-4 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.reuseExampleOdblLabel') }}
      </p>
      <ul class="mt-1 space-y-1 text-xs">
        <li v-for="url in odblExampleUrls" :key="url">
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
