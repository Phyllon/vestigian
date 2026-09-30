<script setup lang="ts">
  /**
   * Required under the German DDG (formerly TMG) §5 independent of GDPR.
   * Operator identity, contact and supervisory-authority content is real
   * (via an Online-Impressum c/o address), not a placeholder — see
   * `.claude/rules/gdpr-legal.md`. `privacy.vue`'s own supervisory-authority
   * block is a *different* thing (the GDPR data-protection authority, not
   * this page's DDG/MStV media-oversight one) and is still unfilled.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('impressum.title') })
  useSeoMeta({ description: t('impressum.intro') })
  useCanonicalUrl()

  useSocialMeta({
    title: t('impressum.title'),
    description: t('impressum.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('impressum.title') }}
    </h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('impressum.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.operatorHeading') }}
      </h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.operatorPlaceholder') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.contactHeading') }}
      </h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.contactPlaceholder') }}
      </p>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        <a
          href="https://mein.online-impressum.de/vestigian/#zweiterkontaktweg"
          target="_blank"
          rel="noopener"
          class="underline underline-offset-2"
        >
          {{ t('impressum.secondContactLabel') }}
        </a>
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.authorityHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.authorityBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.disputeHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.disputeBody') }}
      </p>
    </section>
  </article>
</template>
