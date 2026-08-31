<script setup lang="ts">
  interface SiteMetaProps {
    period: string
    coordinates: string
    modernPlace: string | null
    countryCode: string | null
  }

  const props = defineProps<SiteMetaProps>()

  const { t } = useI18n()

  const location = computed(
    () =>
      [props.modernPlace, props.countryCode].filter(Boolean).join(', ') ||
      t('siteMetaList.locationNotResolved'),
  )

  const copyCoordinates = async (): Promise<void> => {
    await navigator.clipboard.writeText(props.coordinates)
  }
</script>

<template>
  <dl
    class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
  >
    <dt class="eyebrow pt-0.5">{{ t('siteMetaList.period') }}</dt>
    <dd class="text-sm text-ink-700 dark:text-paper-200">{{ period }}</dd>

    <dt class="eyebrow pt-0.5">{{ t('siteMetaList.near') }}</dt>
    <dd class="text-sm text-ink-700 dark:text-paper-200">{{ location }}</dd>

    <dt class="eyebrow pt-0.5">{{ t('siteMetaList.position') }}</dt>
    <dd>
      <!-- The copy affordance only appears on hover, so the name has to carry it. -->
      <button
        type="button"
        class="datum group inline-flex items-center gap-1.5 transition hover:text-oxide-600 dark:hover:text-oxide-300"
        :aria-label="t('siteMetaList.copyCoordinates', { coordinates })"
        @click="copyCoordinates"
      >
        {{ coordinates }}
        <UIcon
          name="i-lucide-copy"
          class="size-3 opacity-0 transition group-hover:opacity-100"
          aria-hidden="true"
        />
      </button>
    </dd>
  </dl>
</template>
