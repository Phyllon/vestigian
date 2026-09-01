<script setup lang="ts">
  /**
   * A contributor's public page. Opt-in — `settings.publicProfile` — and a
   * strict projection of what the endpoint returns, which is deliberately
   * narrow: no email, no role, no trust state, and never the visit log.
   *
   * This page *is* indexed, unlike everything else under an account. That is
   * the point of the switch: someone who ticks it is asking for their work to
   * be attributable, and a page search engines cannot see attributes nothing.
   */
  const route = useRoute()
  const { t } = useI18n()

  const name = computed(() => String(route.params.name))

  const { data: contributor } = await useFetch(
    () => `/api/contributors/${encodeURIComponent(name.value)}`,
  )

  if (!contributor.value) {
    throw createError({ statusCode: 404, statusMessage: t('contributor.notFound') })
  }

  const joined = computed(() => {
    if (!contributor.value) return ''
    const [year, month] = contributor.value.joinedMonth.split('-')
    return new Date(Number(year), Number(month) - 1).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
    })
  })

  useHead({ title: contributor.value.displayName })
  useSeoMeta({
    description: t('contributor.description', { name: contributor.value.displayName }),
  })
  useCanonicalUrl()

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article v-if="contributor">
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ contributor.displayName }}
    </h1>

    <p class="eyebrow mt-2">
      {{ t('contributor.joined', { date: joined }) }} ·
      {{ t('contributor.accepted', contributor.approvedContributions) }}
    </p>

    <p
      v-if="contributor.bio"
      class="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-700 dark:text-paper-200"
    >
      {{ contributor.bio }}
    </p>

    <section v-if="contributor.sites.length > 0" class="mt-8">
      <h2 class="eyebrow">{{ t('contributor.sitesHeading', contributor.sites.length) }}</h2>
      <ul class="mt-3 space-y-2">
        <li v-for="site in contributor.sites" :key="site.id">
          <NuxtLink
            :to="`/site/${site.slug}`"
            class="text-ink-800 hover:text-oxide-700 dark:text-paper-100 dark:hover:text-oxide-400"
          >
            {{ site.title }}
            <span class="eyebrow ml-1">{{ t(`categories.${site.category}`) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section v-if="contributor.tracings.length > 0" class="mt-8">
      <h2 class="eyebrow">{{ t('contributor.tracingsHeading', contributor.tracings.length) }}</h2>
      <ul class="mt-3 space-y-2">
        <li v-for="tracing in contributor.tracings" :key="tracing.id">
          <NuxtLink
            :to="`/tracing/${tracing.id}`"
            class="text-ink-800 hover:text-oxide-700 dark:text-paper-100 dark:hover:text-oxide-400"
          >
            {{ tracing.title }}
          </NuxtLink>
        </li>
      </ul>
    </section>

    <p
      v-if="contributor.sites.length === 0 && contributor.tracings.length === 0"
      class="mt-8 text-sm text-ink-600 dark:text-paper-300"
    >
      {{ t('contributor.nothingPublished') }}
    </p>
  </article>
</template>
