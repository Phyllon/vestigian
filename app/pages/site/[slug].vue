<script setup lang="ts">
  import type { SiteDetail } from '#shared/types'

  definePageMeta({ layout: 'reading' })

  const route = useRoute()

  const { loggedIn } = useSession()

  const { data: site } = await useFetch<SiteDetail>(() => `/api/sites/slug/${route.params.slug}`)

  const period = computed(() =>
    site.value ? formatPeriod(site.value.periodFrom, site.value.periodTo) : '',
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

  useHead(() => ({
    title: site.value?.title,
    meta: [
      { name: 'description', content: site.value?.summary ?? '' },
      { property: 'og:title', content: site.value?.title ?? '' },
      { property: 'og:type', content: 'article' },
    ],
  }))
</script>

<template>
  <div>
    <article v-if="site" class="leaf leaf-margin py-8 pr-8">
      <p class="eyebrow">{{ site.category }}</p>
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

      <SiteExternalLinks
        v-if="site.externalIds.length > 0"
        :identifiers="site.externalIds"
        class="mt-8"
      />

      <footer
        class="mt-10 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-4 dark:border-night-700"
      >
        <UButton :to="mapLink" color="primary" icon="i-lucide-map">Show on the map</UButton>
        <UButton
          v-if="loggedIn"
          :to="`/site/${site.slug}/edit`"
          variant="ghost"
          color="neutral"
          icon="i-lucide-pencil"
        >
          Edit
        </UButton>
        <p class="datum ml-auto">
          Last revised
          {{ new Date(site.updatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) }}
        </p>
      </footer>
    </article>

    <div v-if="site" class="leaf leaf-margin mt-6 py-6 pr-8">
      <UiRevisionHistory :entity-id="site.id" entity-type="site" />
    </div>
  </div>
</template>
