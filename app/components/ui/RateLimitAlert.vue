<script setup lang="ts">
  const props = defineProps<{
    /** The wait, already worded ("15 minutes"). Fixed — see `useRateLimitNotice`. */
    lockedFor: string
    /** A sentence specific to the form; `{wait}` is already filled in by the caller. */
    description?: string
  }>()

  const { t } = useI18n()
</script>

<template>
  <UAlert
    role="alert"
    color="error"
    variant="subtle"
    icon="i-lucide-timer"
    :title="t('rateLimit.title')"
    :description="props.description ?? t('rateLimit.message', { wait: props.lockedFor })"
  />
</template>
