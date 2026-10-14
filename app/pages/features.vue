<script setup lang="ts">
  import { FEATURES, featureExampleTitle } from '#shared/utils/features'

  /**
   * The things this atlas does that are easy to walk past, one entry each: what
   * it is in a few sentences, exactly what the button will switch on, and a
   * button that does it on a real record and leaves the reader at its icon.
   *
   * The entries are data (`shared/utils/features.ts`); this page only renders
   * them. A feature that is not a button — a note with no example — does not
   * belong here: the page is a list of things you can *open*.
   */
  const { t } = useI18n()
  const { status, open } = useFeatureExample()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const openingId = ref<string | null>(null)

  const tryFeature = async (feature: (typeof FEATURES)[number]): Promise<void> => {
    openingId.value = feature.id
    await open(feature)
  }

  const failureMessage = computed(() => {
    if (status.value === 'missing') return t('featuresPage.missing')
    if (status.value === 'failed') return t('featuresPage.failed')
    return null
  })

  useHead({ title: t('featuresPage.title') })
  useSeoMeta({ description: t('featuresPage.description') })
  useCanonicalUrl()

  useSocialMeta({
    title: t('featuresPage.title'),
    description: t('featuresPage.description'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('featuresPage.title') }}
    </h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('featuresPage.intro') }}
    </p>

    <ul class="mt-8 flex flex-col gap-6">
      <li v-for="feature in FEATURES" :key="feature.id">
        <section
          class="leaf p-5"
          :aria-labelledby="`feature-${feature.id}-title`"
          :data-feature="feature.id"
        >
          <div class="flex items-start gap-3">
            <UIcon
              :name="feature.icon"
              class="mt-1 size-6 shrink-0 text-ink-500 dark:text-paper-400"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <h2
                :id="`feature-${feature.id}-title`"
                class="font-display text-xl text-ink-900 dark:text-paper-100"
              >
                {{ t(`featuresPage.features.${feature.id}.title`) }}
              </h2>
              <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
                {{ t(`featuresPage.features.${feature.id}.summary`) }}
              </p>
            </div>
          </div>

          <!-- Said before it is done: a button that changes the map owes the reader the list. -->
          <h3 class="eyebrow mt-4">{{ t('featuresPage.whatHappens') }}</h3>
          <ol
            class="mt-1 list-decimal pl-5 text-sm leading-relaxed text-ink-700 dark:text-paper-200"
          >
            <li v-for="step in feature.steps" :key="step">
              {{
                t(`featuresPage.features.${feature.id}.steps.${step}`, {
                  record: featureExampleTitle(feature.example),
                })
              }}
            </li>
          </ol>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <UButton
              color="primary"
              icon="i-lucide-map-pin"
              :loading="status === 'opening' && openingId === feature.id"
              :disabled="status === 'opening'"
              @click="tryFeature(feature)"
            >
              {{ t('featuresPage.tryIt') }}
            </UButton>

            <p
              v-if="failureMessage && openingId === feature.id"
              class="text-sm text-ink-700 dark:text-paper-200"
              role="alert"
            >
              {{ failureMessage }}
            </p>
          </div>
        </section>
      </li>
    </ul>
  </article>
</template>
