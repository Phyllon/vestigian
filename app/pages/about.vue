<script setup lang="ts">
  /**
   * Purpose for a reader, not a contributor — no architecture, stack or
   * governance detail, which belong to CLAUDE.md. The one exception is the
   * "Operated in the EU" section, which is a public claim about where the
   * service runs and what it does with data.
   *
   * **Every sentence in that section was checked against the code** (CSP,
   * compose files, `nuxt.config.ts`, the privacy page, the telemetry flags), and
   * the list of what it may say lives in `.claude/rules/gdpr-legal.md`. Change
   * the code and this text together: it is worded as "built to follow", never as
   * a guarantee, because a legal-compliance claim is not something a code audit
   * can certify.
   */
  const { t } = useI18n()

  const euPoints = [
    'euProviders',
    'euNoTracking',
    'euStorage',
    'euData',
    'euMeasure',
    'euException',
  ] as const

  const legalLinks = [
    { to: '/privacy', label: 'euLinkPrivacy' },
    { to: '/impressum', label: 'euLinkImpressum' },
    { to: '/licence', label: 'euLinkLicence' },
  ] as const
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
  <article class="relative">
    <UiPageContents />

    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('about.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('about.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="what" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.whatHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.whatBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="who" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.whoHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.whoBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="contribute" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.contributeHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.contributeBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="eu" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('about.euHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.euIntro') }}
      </p>
      <ul
        class="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-700 marker:text-ink-500 dark:text-paper-200 dark:marker:text-paper-400"
      >
        <li v-for="point in euPoints" :key="point">{{ t(`about.${point}`) }}</li>
      </ul>
      <p class="mt-4 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('about.euMore') }}
        <template v-for="(link, index) in legalLinks" :key="link.to">
          <NuxtLink
            :to="link.to"
            class="underline underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
          >
            {{ t(`about.${link.label}`) }}
          </NuxtLink>
          <span v-if="index < legalLinks.length - 1" aria-hidden="true"> · </span>
        </template>
      </p>
    </section>
  </article>
</template>
