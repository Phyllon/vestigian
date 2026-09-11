<script setup lang="ts">
  import type { AtticInscriptionDetail } from '#shared/types'

  /**
   * One Attic Inscriptions Online record. The translation is parsed into a
   * flat, typed segment list at import time
   * (`scripts/import/20-attic-inscriptions.ts`) and rendered here with
   * explicit branches per segment type — never `v-html`, the same
   * discipline the EDH detail page's abbreviation tokens already follow.
   */
  const route = useRoute()
  const aioKey = route.params.aioKey as string
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const { data: inscription } = await useAsyncData<AtticInscriptionDetail | null>(
    `attic-inscription-${aioKey}`,
    () => $fetch<AtticInscriptionDetail>(`/api/attic-inscriptions/${aioKey}`).catch(() => null),
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

  const pleiadesUrl = (pleiadesId: string | null): string | null =>
    pleiadesId ? `https://pleiades.stoa.org/places/${pleiadesId}` : null

  /** The map hash format, same convention as the EDH detail page's own
   *  `mapLink` and `site/[slug]`'s original. */
  const mapLink = computed(() =>
    inscription.value?.position
      ? `/#map=17.00/${inscription.value.position.lat.toFixed(5)}/${inscription.value.position.lon.toFixed(5)}`
      : null,
  )

  /** `@click` + `navigateTo`, not `:to` — see the EDH detail page's own
   *  `goToMap` for why `:to` here falls through to a hard navigation. */
  const goToMap = (): void => {
    if (mapLink.value) void navigateTo(mapLink.value)
  }
</script>

<template>
  <article v-if="inscription">
    <p class="eyebrow">{{ inscription.monumentType ?? inscription.inscriptionType }}</p>
    <h1 class="mt-1 font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ inscription.title }}
    </h1>

    <dl
      class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
    >
      <template v-if="inscription.dateText">
        <dt class="eyebrow pt-0.5">{{ t('atticInscriptions.detail.dated') }}</dt>
        <dd class="datum">{{ inscription.dateText }}</dd>
      </template>
      <template v-if="inscription.primarySource">
        <dt class="eyebrow pt-0.5">{{ t('atticInscriptions.detail.source') }}</dt>
        <dd class="datum">{{ inscription.primarySource }}</dd>
      </template>
      <template v-if="inscription.inscriptionType">
        <dt class="eyebrow pt-0.5">{{ t('atticInscriptions.detail.inscriptionType') }}</dt>
        <dd class="datum">{{ inscription.inscriptionType }}</dd>
      </template>
      <template v-if="inscription.originalLocation">
        <dt class="eyebrow pt-0.5">{{ t('atticInscriptions.detail.originalLocation') }}</dt>
        <dd class="datum">
          {{ inscription.originalLocation.text }}
          <a
            v-if="pleiadesUrl(inscription.originalLocation.pleiadesId)"
            :href="pleiadesUrl(inscription.originalLocation.pleiadesId)!"
            target="_blank"
            rel="noopener noreferrer"
            class="ml-1 underline-offset-2 hover:underline"
            >↗</a
          >
        </dd>
      </template>
      <template v-if="inscription.findspots && inscription.findspots.length > 0">
        <dt class="eyebrow pt-0.5">
          {{
            inscription.findspots.length > 1
              ? t('atticInscriptions.detail.findspots')
              : t('atticInscriptions.detail.findspot')
          }}
        </dt>
        <dd class="datum">
          <span v-for="(findspot, index) in inscription.findspots" :key="index">
            <span v-if="index > 0">; </span>
            <template v-if="findspot.label">{{ findspot.label }}: </template>{{ findspot.text
            }}<a
              v-if="pleiadesUrl(findspot.pleiadesId)"
              :href="pleiadesUrl(findspot.pleiadesId)!"
              target="_blank"
              rel="noopener noreferrer"
              class="ml-0.5 underline-offset-2 hover:underline"
              >↗</a
            >
          </span>
        </dd>
      </template>
      <template v-if="inscription.translators && inscription.translators.length > 0">
        <dt class="eyebrow pt-0.5">{{ t('atticInscriptions.detail.translators') }}</dt>
        <dd class="datum">{{ inscription.translators.join(', ') }}</dd>
      </template>
    </dl>

    <section v-if="inscription.translationEdition" class="mt-6">
      <h2 class="eyebrow">{{ t('atticInscriptions.detail.text') }}</h2>
      <p
        class="prose-notebook mt-3 whitespace-pre-wrap rounded-notebook bg-paper-100 p-4 text-sm leading-relaxed text-ink-900 dark:bg-night-700 dark:text-paper-100"
      >
        <template v-for="(segment, index) in inscription.translationEdition" :key="index">
          <br v-if="segment.type === 'break'" />
          <span
            v-else-if="segment.type === 'lineNumber'"
            class="font-mono text-xs text-ink-400 dark:text-paper-500"
            >{{ segment.text }}</span
          >
          <a
            v-else-if="segment.type === 'place' && pleiadesUrl(segment.pleiadesId ?? null)"
            :href="pleiadesUrl(segment.pleiadesId ?? null)!"
            target="_blank"
            rel="noopener noreferrer"
            class="text-oxide-600 no-underline hover:underline dark:text-oxide-300"
            >{{ segment.text }}</a
          >
          <template v-else-if="segment.type === 'place'">{{ segment.text }}</template>
          <span
            v-else-if="segment.type === 'gloss'"
            class="italic text-ink-500 dark:text-paper-400"
            >{{ segment.text }}</span
          >
          <sup v-else-if="segment.type === 'note'" class="text-oxide-600 dark:text-oxide-300"
            ><a :href="`#attic-note-${segment.number}`">[{{ segment.number }}]</a></sup
          >
          <template v-else>{{ segment.text }}</template>
        </template>
      </p>
    </section>

    <section v-if="inscription.footnotes && inscription.footnotes.length > 0" class="mt-6">
      <h2 class="eyebrow">{{ t('atticInscriptions.detail.footnotes') }}</h2>
      <ol class="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        <li
          v-for="footnote in inscription.footnotes"
          :id="`attic-note-${footnote.number}`"
          :key="footnote.number"
        >
          <span class="font-mono text-xs text-ink-400 dark:text-paper-500"
            >[{{ footnote.number }}]</span
          >
          {{ footnote.text }}
        </li>
      </ol>
    </section>

    <section v-if="inscription.imageCredits && inscription.imageCredits.length > 0" class="mt-6">
      <h2 class="eyebrow">{{ t('atticInscriptions.detail.images') }}</h2>
      <ul class="mt-2 flex flex-wrap gap-2">
        <li v-for="(credit, index) in inscription.imageCredits" :key="index">
          <a
            :href="credit.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-notebook border border-paper-300 px-2.5 py-1 text-xs text-ink-700 transition hover:border-oxide-600 hover:text-oxide-600 dark:border-night-600 dark:text-paper-200 dark:hover:border-oxide-300 dark:hover:text-oxide-300"
          >
            {{ credit.collection }}
            <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </section>

    <section v-if="inscription.references && inscription.references.length > 0" class="mt-6">
      <h2 class="eyebrow">{{ t('atticInscriptions.detail.references') }}</h2>
      <ul class="mt-2 space-y-1 text-sm text-ink-500 dark:text-paper-400">
        <li v-for="(reference, index) in inscription.references" :key="index">
          {{ reference.source }}
          <template v-for="(link, linkIndex) in reference.externalLinks" :key="linkIndex">
            (<a
              :href="link"
              target="_blank"
              rel="noopener noreferrer"
              class="underline-offset-2 hover:underline"
              >↗</a
            >)
          </template>
        </li>
      </ul>
    </section>

    <div
      class="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-3 dark:border-night-700"
    >
      <UButton v-if="mapLink" color="primary" icon="i-lucide-map" @click="goToMap">
        {{ t('atticInscriptions.detail.showOnMap') }}
      </UButton>
      <a
        :href="inscription.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        {{ t('atticInscriptions.detail.viewOnAio') }}
        <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
      </a>
      <p class="datum ml-auto">
        {{ t('atticInscriptions.detail.credit', { licence: inscription.licence }) }}
      </p>
    </div>
  </article>
</template>
