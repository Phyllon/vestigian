<script setup lang="ts">
  const { t } = useI18n()

  definePageMeta({ layout: 'reading' })
  useHead({ title: t('loginPage.title') })
</script>

<template>
  <div class="mx-auto max-w-sm">
    <AuthLoginForm />
  </div>
</template>
