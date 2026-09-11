<script setup lang="ts">
  import type { SiteDetail } from '#shared/types'
  import { buildBreadcrumbJsonLd, buildSiteJsonLd } from '#shared/utils/structuredData'

  definePageMeta({ layout: 'reading' })

  const { t, locale } = useI18n()
  const route = useRoute()
  const config = useRuntimeConfig()

  const { loggedIn } = useSession()
  const { buildUrl } = useImageUrl()

  const { data: site } = await useFetch<SiteDetail>(() => `/api/sites/slug/${route.params.slug}`)

  const { enrichment, isLoadingEnrichment } = useSiteEnrichment(() => site.value?.id ?? null)

  const period = computed(() =>
    site.value ? formatPeriod(site.value.periodFrom, site.value.periodTo, t) : '',
  )

  const coordinates = computed(() =>
    site.value
      ? `${site.value.position.lat.toFixed(5)}, ${site.value.position.lon.toFixed(5)}`
      : '',
  )

  /** The map hash format, so following this lands the map on the site. */
  const mapLink = computed(() =>
    site.value
      ? `/#map=16.00/${site.value.position.lat.toFixed(5)}/${site.value.position.lon.toFixed(5)}`
      : '/',
  )

  /**
   * `@click` + `navigateTo`, not `:to`. A `UButton`/`NuxtLink` whose target
   * differs from the current route only by its hash (`/#map=...`) falls
   * through to a plain, router-unintercepted anchor and triggers a full
   * browser navigation — confirmed live, and the reason every overlay
   * toggle (`useState`, which lives on the Nuxt app instance and is wiped
   * by a hard reload) used to reset after following this link.
   * `navigateTo` goes through Vue Router directly instead.
   */
  const goToMap = (): void => {
    void navigateTo(mapLink.value)
  }

  const base = config.public.siteUrl.replace(/\/$/, '')

  const ogImageUrl = computed(() => {
    if (!site.value) return `${base}/og/default.png`
    if (site.value.images.length > 0) return `${base}${buildUrl(site.value.images[0]!, 'og')}`
    return `${base}/og/${site.value.category}.png`
  })

  useHead(() => ({
    title: site.value?.title,
    meta: [{ name: 'description', content: site.value?.summary ?? '' }],
  }))

  useSocialMeta({
    title: site.value?.title ?? '',
    description: site.value?.summary ?? '',
    imageUrl: ogImageUrl.value,
    type: 'article',
  })

  useCanonicalUrl()

  useHead(() => ({
    script: site.value
      ? [
          {
            type: 'application/ld+json',
            innerHTML: JSON.stringify(
              buildSiteJsonLd({
                title: site.value.title,
                summary: site.value.summary,
                slug: site.value.slug,
                position: site.value.position,
                modernPlace: site.value.modernPlace,
                countryCode: site.value.countryCode,
                updatedAt: site.value.updatedAt,
                siteUrl: base,
                imageUrls: site.value.images.map((image) => `${base}${buildUrl(image, 'og')}`),
              }),
            ),
          },
          {
            type: 'application/ld+json',
            innerHTML: JSON.stringify(
              buildBreadcrumbJsonLd({
                items: [
                  { name: 'Vestigian', url: base },
                  { name: site.value.title, url: `${base}/site/${site.value.slug}` },
                ],
              }),
            ),
          },
        ]
      : [],
  }))
</script>

<template>
  <div>
    <article v-if="site" class="leaf p-8">
      <p class="eyebrow">{{ t(`categories.${site.category}`) }}</p>
      <h1 class="mt-2 text-4xl leading-tight">{{ site.title }}</h1>

      <p v-if="site.summary" class="mt-3 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
        {{ site.summary }}
      </p>

      <SiteMetaList
        :period="period"
        :coordinates="coordinates"
        :modern-place="site.modernPlace"
        :country-code="site.countryCode"
        class="mt-6"
      />

      <SiteGallery v-if="site.images.length > 0" :images="site.images" class="mt-8" />

      <div
        v-if="site.description"
        class="mt-8 space-y-4 text-[1.0625rem] leading-relaxed text-ink-700 dark:text-paper-200"
      >
        <p v-for="(paragraph, index) in site.description.split('\n\n')" :key="index">
          {{ paragraph }}
        </p>
      </div>

      <SiteEnrichment
        :enrichment="enrichment"
        :is-loading="isLoadingEnrichment"
        class="mt-8 block"
      />

      <SiteExternalLinks
        v-if="site.externalIds.length > 0"
        :identifiers="site.externalIds"
        class="mt-8"
      />

      <EpigraphyNearbyInscriptions :id="site.id" kind="site" class="mt-8" />
      <EpigraphyNearbyAtticInscriptions :id="site.id" kind="site" class="mt-8" />

      <SiteEndorsementButton v-model="site" class="mt-8" />

      <footer
        class="mt-10 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-4 dark:border-night-700"
      >
        <UButton color="primary" icon="i-lucide-map" @click="goToMap">{{
          t('siteDetailPage.showOnMap')
        }}</UButton>
        <UButton
          v-if="loggedIn"
          :to="`/site/${site.slug}/edit`"
          variant="ghost"
          color="neutral"
          icon="i-lucide-pencil"
        >
          {{ t('siteDetailPage.edit') }}
        </UButton>
        <p class="datum ml-auto">
          {{ t('siteDetailPage.lastRevised') }}
          <time :datetime="site.updatedAt">{{ formatDate(site.updatedAt, locale) }}</time>
        </p>
      </footer>
    </article>

    <UiRevisionHistory v-if="site" :entity-id="site.id" entity-type="site" class="mt-6" />
  </div>
</template>
