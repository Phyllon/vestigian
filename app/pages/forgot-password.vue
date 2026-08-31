<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const { t } = useI18n()

  definePageMeta({ layout: 'reading' })
  useHead({ title: t('forgotPasswordPage.title') })
  useNoIndex()

  const schema = z.object({ email: z.string().email(t('forgotPasswordPage.errorEmail')) })
  type ForgotState = z.output<typeof schema>

  const state = reactive<Partial<ForgotState>>({ email: '' })
  const isSent = ref(false)
  const isSubmitting = ref(false)

  const request = async (event: FormSubmitEvent<ForgotState>): Promise<void> => {
    isSubmitting.value = true
    try {
      await $fetch('/api/auth/forgot-password', { method: 'POST', body: event.data })
    } finally {
      // The confirmation is shown either way, so this page cannot be used to
      // discover which addresses have accounts.
      isSent.value = true
      isSubmitting.value = false
    }
  }
</script>

<template>
  <div class="mx-auto max-w-sm">
    <div v-if="isSent" class="leaf p-6" role="status">
      <h1 class="text-xl">{{ t('forgotPasswordPage.checkInbox') }}</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
        {{ t('forgotPasswordPage.checkInboxBody') }}
      </p>
    </div>

    <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="request">
      <header>
        <h1 class="text-2xl">{{ t('forgotPasswordPage.title') }}</h1>
        <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
          {{ t('forgotPasswordPage.intro') }}
        </p>
      </header>

      <UFormField :label="t('forgotPasswordPage.email')" name="email" required>
        <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
      </UFormField>

      <UButton type="submit" :loading="isSubmitting" color="primary" block>{{
        t('forgotPasswordPage.sendLink')
      }}</UButton>
    </UForm>
  </div>
</template>
