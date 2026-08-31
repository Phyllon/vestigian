<script setup lang="ts">
  /**
   * Terms differ per layer, so this page states each one rather than a single
   * blanket label. Contributed text/metadata is genuinely reusable, including
   * commercially — it would be inaccurate to call the whole site
   * "non-commercial" the way the DARE basemap specifically is, per its own
   * NC-credited source layers (see CLAUDE.md's antiquity-basemaps section).
   */
  const { t } = useI18n()

  useHead({ title: t('licence.title') })
  useSeoMeta({ description: t('licence.intro') })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('licence.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('licence.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.recordsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.recordsBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.imagesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.imagesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.barringtonHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.barringtonBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.dareHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.dareBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('licence.limesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('licence.limesBody') }}
      </p>
    </section>
  </article>
</template>
