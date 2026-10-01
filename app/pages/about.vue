<script setup lang="ts">
  /**
   * Purpose only, for a reader, not a contributor — no architecture, stack or
   * governance detail. That belongs to CLAUDE.md, not this page.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('about.title') })
  useSeoMeta({ description: t('about.intro') })
  useCanonicalUrl()

  useSocialMeta({
    title: t('about.title'),
    description: t('about.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('about.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('about.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.whatHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.whatBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.whoHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.whoBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.contributeHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.contributeBody') }}
      </p>
    </section>
  </article>
</template>
