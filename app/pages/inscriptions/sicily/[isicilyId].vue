<script setup lang="ts">
  import type { IsicilyInscriptionDetail } from '#shared/types'
  import { formatPeriod } from '~/composables/data/useSiteQuery'

  /**
   * One I.Sicily record. The text is shown as plain text in Leiden convention —
   * `man(ibus)` for an expanded abbreviation, `[…]` for a supplied letter — which
   * the import produced from the EpiDoc; nothing here is `v-html`. The photograph is
   * deliberately absent (see `scripts/import/24-isicily-inscriptions.ts`): the page
   * links to I.Sicily's own, where it lives under its own terms.
   */
  const route = useRoute()
  const isicilyId = route.params.isicilyId as string
  const { t, te } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const { data: inscription } = await useAsyncData<IsicilyInscriptionDetail | null>(
    `isicily-inscription-${isicilyId}`,
    () =>
      $fetch<IsicilyInscriptionDetail>(`/api/isicily-inscriptions/${isicilyId}`).catch(() => null),
    { default: () => null },
  )

  if (!inscription.value) {
    throw createError({ statusCode: 404, statusMessage: 'Inscription not found', fatal: true })
  }

  useHead({ title: inscription.value.title })
  useSeoMeta({ description: inscription.value.title })
  useCanonicalUrl()
  useSocialMeta({
    title: inscription.value.title,
    description: inscription.value.title,
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })

  const KNOWN_LANGUAGES = ['grc', 'la', 'xly', 'scx', 'xpu', 'osc', 'he']

  const languageLabel = computed(() => {
    const code = inscription.value?.language
    return code && KNOWN_LANGUAGES.includes(code)
      ? t(`isicilyInscriptions.languages.${code}`)
      : null
  })

  /**
   * I.Sicily's `function` is a dotted vocabulary (`dedication.votive`,
   * `legal.contract`). The family before the first dot is what is translated; one the
   * catalogue has no word for is left out rather than shown as a raw key.
   */
  const functionLabel = computed(() => {
    const family = inscription.value?.inscriptionFunction?.split(/[.\s]/)[0]
    const key = `isicilyInscriptions.functions.${family}`
    return family && te(key) ? t(key) : null
  })

  const licenceLabel = computed(() =>
    inscription.value?.licence === 'CC-BY-NC-4.0' ? 'CC BY-NC 4.0' : 'CC BY 4.0',
  )

  const period = computed(() =>
    formatPeriod(inscription.value?.notBefore ?? null, inscription.value?.notAfter ?? null, t),
  )

  const pleiadesUrl = computed(() =>
    inscription.value?.pleiadesId
      ? `https://pleiades.stoa.org/places/${inscription.value.pleiadesId}`
      : null,
  )

  /**
   * Trismegistos and EDCS ids are shown as plain identifiers, not links: both sites
   * refuse automated requests (a bot challenge and a single-page app), so no URL
   * pattern could be verified here, and a guessed link is worse than none. EDR's
   * record page was fetched and shows the id, so that one is linked.
   */
  const edrUrl = computed(() =>
    inscription.value?.edrId && /^\d+$/.test(inscription.value.edrId)
      ? `https://www.edr-edr.it/edr_programmi/res_complex_comune.php?do=book&id_nr=EDR${inscription.value.edrId}`
      : null,
  )

  const mapLink = computed(() =>
    inscription.value?.position
      ? `/#map=14.00/${inscription.value.position.lat.toFixed(5)}/${inscription.value.position.lon.toFixed(5)}`
      : null,
  )

  /** `@click` + `navigateTo`, not `:to` — see the EDH detail page's own `goToMap`. */
  const goToMap = (): void => {
    if (mapLink.value) void navigateTo(mapLink.value)
  }
</script>

<template>
  <article v-if="inscription">
    <p class="eyebrow">{{ t('isicilyInscriptions.detail.eyebrow') }}</p>
    <h1 class="mt-1 font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ inscription.title }}
    </h1>

    <dl
      class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
    >
      <template v-if="inscription.dateText || period">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.dated') }}</dt>
        <dd class="datum">
          {{ inscription.dateText ?? period }}
          <span
            v-if="inscription.dateText && period !== t('periodFormat.undated')"
            class="text-ink-500 dark:text-paper-400"
          >
            ({{ period }})
          </span>
        </dd>
      </template>
      <template v-if="languageLabel">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.language') }}</dt>
        <dd class="datum">{{ languageLabel }}</dd>
      </template>
      <template v-if="functionLabel">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.kind') }}</dt>
        <dd class="datum">{{ functionLabel }}</dd>
      </template>
      <template v-if="inscription.objectType">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.object') }}</dt>
        <dd class="datum">{{ inscription.objectType }}</dd>
      </template>
      <template v-if="inscription.material">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.material') }}</dt>
        <dd class="datum">{{ inscription.material }}</dd>
      </template>
      <template v-if="inscription.placeName">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.place') }}</dt>
        <dd class="datum">{{ inscription.placeName }}</dd>
      </template>
      <template v-if="inscription.ancientPlaceName">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.ancientPlace') }}</dt>
        <dd class="datum">
          {{ inscription.ancientPlaceName }}
          <a
            v-if="pleiadesUrl"
            :href="pleiadesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ml-1 underline-offset-2 hover:underline"
            aria-label="Pleiades"
            >↗</a
          >
        </dd>
      </template>
      <template v-if="inscription.repository">
        <dt class="eyebrow pt-0.5">{{ t('isicilyInscriptions.detail.repository') }}</dt>
        <dd class="datum">{{ inscription.repository }}</dd>
      </template>
    </dl>

    <p v-if="inscription.position" class="mt-2 text-xs text-ink-500 dark:text-paper-400">
      {{ t('isicilyInscriptions.detail.approximatePlace') }}
    </p>

    <section v-if="inscription.provenance" class="mt-6">
      <h2 class="eyebrow">{{ t('isicilyInscriptions.detail.provenance') }}</h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ inscription.provenance }}
      </p>
    </section>

    <section v-if="inscription.edition" class="mt-6">
      <h2 class="eyebrow">{{ t('isicilyInscriptions.detail.edition') }}</h2>
      <p
        class="mt-3 whitespace-pre-wrap rounded-notebook bg-paper-100 p-4 font-mono text-sm leading-relaxed text-ink-900 dark:bg-night-700 dark:text-paper-100"
        :lang="inscription.language ?? undefined"
      >
        {{ inscription.edition }}
      </p>
    </section>

    <section v-if="inscription.translation" class="mt-6">
      <h2 class="eyebrow">{{ t('isicilyInscriptions.detail.translation') }}</h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-900 dark:text-paper-100" lang="en">
        {{ inscription.translation }}
      </p>
    </section>

    <section
      v-if="inscription.trismegistosId || inscription.edcsId || inscription.edrId"
      class="mt-6"
    >
      <h2 class="eyebrow">{{ t('isicilyInscriptions.detail.identifiers') }}</h2>
      <ul
        class="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-500 dark:text-paper-400"
      >
        <li v-if="inscription.trismegistosId">TM {{ inscription.trismegistosId }}</li>
        <li v-if="inscription.edcsId">EDCS-{{ inscription.edcsId }}</li>
        <li v-if="inscription.edrId">
          <a
            v-if="edrUrl"
            :href="edrUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
            >EDR{{ inscription.edrId }} ↗</a
          >
          <template v-else>EDR{{ inscription.edrId }}</template>
        </li>
      </ul>
    </section>

    <p class="mt-6 text-xs text-ink-500 dark:text-paper-400">
      {{ t('isicilyInscriptions.detail.photoNote') }}
    </p>
    <p
      v-if="inscription.licence === 'CC-BY-NC-4.0'"
      class="mt-2 text-xs font-medium text-ink-700 dark:text-paper-200"
    >
      {{ t('isicilyInscriptions.detail.nonCommercialNote') }}
    </p>

    <div
      class="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-3 dark:border-night-700"
    >
      <UButton v-if="mapLink" color="primary" icon="i-lucide-map" @click="goToMap">
        {{ t('isicilyInscriptions.detail.showOnMap') }}
      </UButton>
      <a
        :href="inscription.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        {{ t('isicilyInscriptions.detail.viewOnIsicily') }}
        <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
      </a>
      <p class="datum ml-auto">
        {{ t('isicilyInscriptions.detail.credit', { licence: licenceLabel }) }}
      </p>
    </div>
  </article>
</template>
