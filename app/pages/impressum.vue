<script setup lang="ts">
  /**
   * Required under the German DDG (formerly TMG) §5 independent of GDPR —
   * every one of the placeholder blocks below needs the operator's real
   * identity before this goes live. See CLAUDE.md's "GDPR / legal" section.
   */
  const { t } = useI18n()

  useHead({ title: t('impressum.title') })
  useSeoMeta({ description: t('impressum.intro') })

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
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.registerHeading') }}
      </h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.registerPlaceholder') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.vatHeading') }}
      </h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.vatPlaceholder') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('impressum.responsibleHeading') }}
      </h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('impressum.responsiblePlaceholder') }}
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
