<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'reading' })
useHead({ title: 'Reset your password' })

const schema = z.object({ email: z.string().email('That does not look like an email address.') })
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
    <div v-if="isSent" class="leaf leaf-margin py-6 pr-6">
      <h1 class="text-xl">Check your inbox</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
        If that address has an account, a reset link is on its way. It works for one hour.
      </p>
    </div>

    <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="request">
      <header>
        <h1 class="text-2xl">Reset your password</h1>
        <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
          We will send a link to set a new one.
        </p>
      </header>

      <UFormField label="Email" name="email" required>
        <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
      </UFormField>

      <UButton type="submit" :loading="isSubmitting" color="primary" block>Send the link</UButton>
    </UForm>
  </div>
</template>
