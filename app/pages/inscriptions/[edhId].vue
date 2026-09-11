<script setup lang="ts">
  import type { InscriptionDetail } from '#shared/types'

  /**
   * One mirrored EDH inscription. The transcription is set in IBM Plex
   * Mono with the source's own line breaks preserved — a field-notebook
   * transcription of an inscription looks like this, not like flowing
   * prose — and abbreviations render as real `<abbr>` elements: a native,
   * accessible way to carry "as carved" alongside its expansion, rather
   * than an invented tooltip widget.
   */
  const route = useRoute()
  const edhId = route.params.edhId as string
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const { data: inscription } = await useAsyncData<InscriptionDetail | null>(
    `inscription-${edhId}`,
    () => $fetch<InscriptionDetail>(`/api/inscriptions/${edhId}`).catch(() => null),
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
</script>

<template>
  <article v-if="inscription">
    <p class="eyebrow">{{ typeLabel ?? inscription.objectType }}</p>
    <h1 class="mt-1 font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ inscription.title }}
    </h1>

    <dl
      class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
    >
      <template v-if="period">
        <dt class="eyebrow pt-0.5">{{ t('epigraphy.detail.dated') }}</dt>
        <dd class="datum">{{ period }}</dd>
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
      ><code><template v-for="line in inscription.textEdition" :key="line.line">{{ line.line }}  <template v-for="(token, index) in line.tokens" :key="index"><abbr
              v-if="token.abbr"
              :title="token.expansion ? `${token.abbr}(${token.expansion})` : token.abbr"
              class="cursor-help font-semibold text-oxide-600 no-underline decoration-dotted dark:text-oxide-300"
              >{{ token.abbr }}</abbr
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
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
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
