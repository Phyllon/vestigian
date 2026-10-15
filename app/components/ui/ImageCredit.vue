<script setup lang="ts">
  import { licenceLabel, licenceUri } from '#shared/utils/licence-uris'

  /**
   * The credit under a photograph: who made it and the licence it is under, the
   * licence as a link to its text. CC BY, BY-SA and the rest ask for "a URI or
   * hyperlink to the licence", and a bare code such as `CC-BY-SA-3.0` is neither;
   * a licence with no known text (public domain, an unrecognised code) is shown
   * as it is rather than linked to a guess.
   *
   * Never collapsed behind an interaction — the attribution is the obligation.
   */
  const props = defineProps<{
    attribution: string | null
    licence: string | null
  }>()

  const { t } = useI18n()

  const attribution = computed(() => props.attribution?.trim() || null)
  const licence = computed(() => props.licence?.trim() || null)
  const licenceUrl = computed(() => (licence.value ? licenceUri(licence.value) : null))
  const licenceText = computed(() => (licence.value ? licenceLabel(licence.value) : null))
</script>

<template>
  <p class="datum text-[0.6875rem]">
    <template v-if="!attribution && !licenceText">{{ t('imageCredit.unknown') }}</template>
    <template v-if="attribution">{{ attribution }}</template>
    <template v-if="attribution && licenceText"> · </template>
    <a
      v-if="licenceText && licenceUrl"
      :href="licenceUrl"
      rel="license noopener"
      target="_blank"
      class="underline decoration-paper-400 underline-offset-2 dark:decoration-night-600"
      >{{ licenceText }}</a
    >
    <template v-else-if="licenceText">{{ licenceText }}</template>
  </p>
</template>
