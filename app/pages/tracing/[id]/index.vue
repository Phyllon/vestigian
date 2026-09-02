<script setup lang="ts">
  import type { TracingDetail } from '~/composables/data/useSiteQuery'
  import { buildBreadcrumbJsonLd, buildTracingJsonLd } from '#shared/utils/structuredData'

  definePageMeta({ layout: 'reading' })

  const { t, te, locale } = useI18n()
  const route = useRoute()
  const config = useRuntimeConfig()
  const { loggedIn } = useSession()

  const { data: tracing } = await useFetch<TracingDetail>(() => `/api/tracings/${route.params.id}`)

  if (!tracing.value) {
    throw createError({ statusCode: 404, statusMessage: t('tracingDetailPage.notFound') })
  }

  const base = config.public.siteUrl.replace(/\/$/, '')
  const description = computed(
    () => tracing.value?.description ?? t('tracingDetailPage.defaultDescription'),
  )

  useHead({
    title: () => tracing.value?.title,
    meta: [{ name: 'description', content: description }],
  })

  useSocialMeta({
    title: tracing.value.title,
    description: description.value,
    imageUrl: `${base}/og/tracing.png`,
    type: 'article',
  })

  useCanonicalUrl()

  useHead(() => ({
    script: tracing.value
      ? [
          {
            type: 'application/ld+json',
            innerHTML: JSON.stringify(
              buildTracingJsonLd({
                id: tracing.value.id,
                title: tracing.value.title,
                description: tracing.value.description,
                updatedAt: tracing.value.updatedAt,
                siteUrl: base,
              }),
            ),
          },
          {
            type: 'application/ld+json',
            innerHTML: JSON.stringify(
              buildBreadcrumbJsonLd({
                items: [
                  { name: 'Vestigian', url: base },
                  { name: tracing.value.title, url: `${base}/tracing/${tracing.value.id}` },
                ],
              }),
            ),
          },
        ]
      : [],
  }))

  const length = computed(() => formatLength(tracing.value?.lengthMetres ?? null))
</script>

<template>
  <div v-if="tracing" class="space-y-6">
    <article class="leaf p-8">
      <p class="eyebrow">
        {{
          tracing.kind === 'area'
            ? t('tracingDetailPage.tracedArea')
            : t('tracingDetailPage.tracedRoute')
        }}
      </p>
      <h1 class="mt-2 text-4xl leading-tight">{{ tracing.title }}</h1>

      <dl
        class="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
      >
        <dt class="eyebrow pt-0.5">{{ t('tracingDetailPage.type') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            te(`categories.${tracing.category}`)
              ? t(`categories.${tracing.category}`)
              : tracing.category
          }}
        </dd>

        <template v-if="length">
          <dt class="eyebrow pt-0.5">{{ t('tracingDetailPage.length') }}</dt>
          <dd class="datum">{{ length }}</dd>
        </template>

        <dt class="eyebrow pt-0.5">{{ t('tracingDetailPage.credit') }}</dt>
        <dd class="datum">
          {{ tracing.attribution ?? t('tracingDetailPage.defaultAttribution') }} ·
          {{ tracing.licence }}
        </dd>
      </dl>

      <div
        v-if="tracing.description"
        class="mt-6 space-y-4 text-[1.0625rem] leading-relaxed text-ink-700 dark:text-paper-200"
      >
        <p v-for="(paragraph, index) in tracing.description.split('\n\n')" :key="index">
          {{ paragraph }}
        </p>
      </div>

      <footer
        class="mt-10 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-4 dark:border-night-700"
      >
        <UButton
          v-if="loggedIn"
          :to="`/tracing/${tracing.id}/edit`"
          color="primary"
          icon="i-lucide-pencil"
        >
          {{ t('tracingDetailPage.edit') }}
        </UButton>
        <p class="datum ml-auto">
          {{ t('tracingDetailPage.lastRevised') }}
          <time :datetime="tracing.updatedAt">{{ formatDate(tracing.updatedAt, locale) }}</time>
        </p>
      </footer>
    </article>

    <div class="leaf px-8 py-6">
      <UiRevisionHistory :entity-id="tracing.id" entity-type="tracing" />
    </div>
  </div>
</template>
