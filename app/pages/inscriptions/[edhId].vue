<script setup lang="ts">
  import type { InscriptionDetail } from '#shared/types'

  /**
   * One mirrored EDH inscription. The transcription is set in IBM Plex
   * Mono with the source's own line breaks preserved — a field-notebook
   * transcription of an inscription looks like this, not like flowing
   * prose. Abbreviations keep the real `<abbr title="...">` element for
   * its native accessible fallback, but the `title` attribute alone is
   * hover-only and never fires on a touch device — reported live as "tap
   * doesn't open the expansion". The disclosure itself is a `UPopover`
   * (mode="click", the Nuxt UI default), wrapping the `<abbr>` in a plain
   * reset `<button>` so it is both tappable and keyboard-focusable.
   */
  const route = useRoute()
  const edhId = route.params.edhId as string
  const { t, locale } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  /**
   * Re-fetches when the reader switches interface language, since the
   * server does the translating (see `/api/inscriptions/[edhId].get.ts`) and
   * a locale switch is otherwise invisible to `useAsyncData`'s own cache.
   */
  const { data: inscription } = await useAsyncData<InscriptionDetail | null>(
    `inscription-${edhId}`,
    () =>
      $fetch<InscriptionDetail>(`/api/inscriptions/${edhId}`, {
        query: { lang: locale.value },
      }).catch(() => null),
    { default: () => null, watch: [locale] },
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

  const period = computed(() =>
    inscription.value
      ? formatPeriod(inscription.value.notBefore, inscription.value.notAfter, t)
      : '',
  )

  const typeLabel = computed(() => {
    const value = inscription.value?.inscriptionType
    if (!value) return null
    const key = `epigraphy.types.${value}`
    return t(key) !== key ? t(key) : value
  })

  const dimensions = computed(() => {
    const item = inscription.value
    if (!item) return null
    const parts = [item.heightCm, item.widthCm, item.depthCm].filter(
      (value): value is number => value !== null,
    )
    return parts.length > 0 ? `${parts.join(' × ')} cm` : null
  })

  /** The map hash format (`useMapInstance.ts`'s `useCameraState`), so
   *  following this lands the map zoomed in on this inscription's own
   *  findspot — the same convention `site/[slug]`'s own `mapLink` uses. */
  const mapLink = computed(() =>
    inscription.value?.position
      ? `/#map=17.00/${inscription.value.position.lat.toFixed(5)}/${inscription.value.position.lon.toFixed(5)}`
      : null,
  )

  /**
   * `@click` + `navigateTo`, not `:to`. `UButton`'s `to` prop, for a target
   * like `/#map=...` (a different route than the current one, distinguished
   * only by its hash), renders a plain link that falls through to a full
   * browser navigation rather than a router-intercepted one — confirmed
   * live, and the reason "the overlays are deactivated" after following
   * this link: a hard navigation discards `useState`, which is where every
   * overlay toggle lives. `navigateTo` goes through Vue Router directly,
   * so this is a genuine client-side route change.
   */
  const goToMap = (): void => {
    if (mapLink.value) void navigateTo(mapLink.value)
  }

  const nameOf = (code: string): string => {
    const known = t(`enrichment.languages.${code}`)
    return known === `enrichment.languages.${code}` ? code.toUpperCase() : known
  }

  /** Same three-case shape `SiteEnrichment.vue`'s `languageNote` already
   *  uses for borrowed prose — reused as-is, since a machine standing
   *  between a reader and EDH's own words deserves the same disclosure. */
  const languageNote = computed(() => {
    const item = inscription.value
    if (!item) return null

    if (item.isMachineTranslated) {
      return t('enrichment.machineTranslatedFrom', { language: nameOf(item.originalLanguage) })
    }

    return item.language === locale.value
      ? null
      : t('enrichment.inLanguage', { language: nameOf(item.language) })
  })
</script>

<template>
  <article v-if="inscription">
    <p class="eyebrow">{{ typeLabel ?? inscription.objectType }}</p>
    <h1
      :lang="inscription.language"
      class="mt-1 font-display text-3xl text-ink-900 dark:text-paper-100"
    >
      {{ inscription.title }}
    </h1>
    <p v-if="languageNote" class="mt-1 text-xs text-ink-500 dark:text-paper-400">
      {{ languageNote }}
    </p>

    <dl
      class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
    >
      <template v-if="period">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.dated') }}</dt>
        <dd class="datum">{{ period }}</dd>
      </template>
      <template v-if="inscription.empireStates.length > 0">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.empireState') }}</dt>
        <dd class="datum">{{ inscription.empireStates.join(' / ') }}</dd>
      </template>
      <template v-if="inscription.material">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.material') }}</dt>
        <dd class="datum">{{ inscription.material }}</dd>
      </template>
      <template v-if="dimensions">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.dimensions') }}</dt>
        <dd class="datum">{{ dimensions }}</dd>
      </template>
      <template v-if="inscription.letterHeightCm">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.letterHeight') }}</dt>
        <dd class="datum">{{ inscription.letterHeightCm }} cm</dd>
      </template>
      <template v-if="inscription.originPlaceName">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.origin') }}</dt>
        <dd class="datum">
          {{ inscription.originPlaceName
          }}<template v-if="inscription.provinceName">, {{ inscription.provinceName }}</template>
        </dd>
      </template>
      <template v-if="inscription.findModernPlace">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.foundAt') }}</dt>
        <dd class="datum">{{ inscription.findModernPlace }}</dd>
      </template>
    </dl>

    <section v-if="inscription.textEdition && inscription.textEdition.length > 0" class="mt-6">
      <h2 class="eyebrow">{{ t('epigraphy.detail.text') }}</h2>
      <p class="datum mt-1">{{ t('epigraphy.detail.textHint') }}</p>
      <pre
        class="prose-notebook mt-3 overflow-x-auto whitespace-pre-wrap rounded-notebook bg-paper-100 p-4 font-mono text-sm leading-relaxed text-ink-900 dark:bg-night-700 dark:text-paper-100"
      ><code><template v-for="line in inscription.textEdition" :key="line.line">{{ line.line }}  <template v-for="(token, index) in line.tokens" :key="index"><UPopover
              v-if="token.abbr"
              mode="click"
              :content="{ side: 'top' }"
              ><button
                type="button"
                class="cursor-pointer border-0 bg-transparent p-0 align-baseline"
                ><abbr
                  :title="token.expansion ? `${token.abbr}(${token.expansion})` : token.abbr"
                  class="font-semibold text-oxide-600 no-underline decoration-dotted dark:text-oxide-300"
                  >{{ token.abbr }}</abbr
                ></button
              ><template #content
                ><p class="max-w-xs px-3 py-1.5 text-sm text-ink-900 dark:text-paper-100"
                  ><span class="font-mono font-semibold">{{ token.abbr }}</span
                  ><template v-if="token.expansion"> — {{ token.expansion }}</template></p
                ></template
              ></UPopover
            ><template v-else>{{ token.text }}</template>{{ ' ' }}</template>
</template></code></pre>
    </section>

    <section v-if="inscription.photos.length > 0" class="mt-6">
      <h2 class="eyebrow">{{ t('epigraphy.detail.photographs') }}</h2>
      <p class="datum mt-1">
        {{ t('epigraphy.detail.photographsHint', { count: inscription.photoCount }) }}
      </p>
      <ul class="mt-2 flex flex-wrap gap-2">
        <li v-for="photo in inscription.photos" :key="photo.edhPhotoId">
          <a
            :href="photo.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-notebook border border-paper-300 px-2.5 py-1 text-xs text-ink-700 transition hover:border-oxide-600 hover:text-oxide-600 dark:border-night-600 dark:text-paper-200 dark:hover:border-oxide-300 dark:hover:text-oxide-300"
          >
            {{ photo.rightsHolder ?? photo.edhPhotoId }}
            <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
          </a>
        </li>
      </ul>
      <p v-if="inscription.photoCount > inscription.photos.length" class="datum mt-2">
        {{
          t('epigraphy.detail.morePhotos', {
            count: inscription.photoCount - inscription.photos.length,
          })
        }}
      </p>
    </section>

    <section v-if="inscription.commentary" class="mt-6">
      <h2 class="eyebrow">{{ t('epigraphy.detail.commentary') }}</h2>
      <p
        :lang="inscription.language"
        class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200"
      >
        {{ inscription.commentary }}
      </p>
    </section>

    <section v-if="inscription.bibliography && inscription.bibliography.length > 0" class="mt-6">
      <h2 class="eyebrow">{{ t('epigraphy.detail.bibliography') }}</h2>
      <ul class="mt-2 space-y-1 text-sm text-ink-500 dark:text-paper-400">
        <li v-for="(entry, index) in inscription.bibliography" :key="index">{{ entry }}</li>
      </ul>
    </section>

    <div
      class="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-3 dark:border-night-700"
    >
      <UButton v-if="mapLink" color="primary" icon="i-lucide-map" @click="goToMap">
        {{ t('epigraphy.detail.showOnMap') }}
      </UButton>
      <a
        :href="inscription.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        {{ t('epigraphy.detail.viewOnEdh') }}
        <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
      </a>
      <p class="datum ml-auto">
        {{ t('epigraphy.detail.credit', { licence: inscription.licence }) }}
      </p>
    </div>
  </article>
</template>
