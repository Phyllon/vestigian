<script setup lang="ts">
  const { t } = useI18n()

  definePageMeta({ layout: 'reading' })
  useHead({ title: t('registerPage.title') })
  useNoIndex()
</script>

<template>
  <div class="mx-auto max-w-sm">
    <AuthRegisterForm />
  </div>
</template>
