<script setup lang="ts">
  import { z } from 'zod'
  import { passwordSchema } from '#shared/utils/password'
  import type { FormSubmitEvent } from '@nuxt/ui'

  definePageMeta({ layout: 'reading' })
  useHead({ title: 'Set a new password' })

  const route = useRoute()
  const toast = useToast()
  const isSubmitting = ref(false)

  const schema = z
    .object({
      password: passwordSchema,
      passwordConfirmation: z.string(),
    })
    .refine((values) => values.password === values.passwordConfirmation, {
      message: 'The two passwords do not match.',
      path: ['passwordConfirmation'],
    })

  type ResetState = z.output<typeof schema>

  const state = reactive<Partial<ResetState>>({ password: '', passwordConfirmation: '' })

  const isComplete = computed(() => schema.safeParse(state).success)

  const submit = async (event: FormSubmitEvent<ResetState>): Promise<void> => {
    isSubmitting.value = true
    try {
      await $fetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token: route.query.token, password: event.data.password },
      })
      toast.add({ title: 'Password changed. Sign in with the new one.', color: 'success' })
      await navigateTo('/login')
    } catch (error) {
      toast.add({
        title: 'Could not reset',
        description:
          (error as { data?: { message?: string } }).data?.message ?? 'Ask for a new link.',
        color: 'error',
      })
    } finally {
      isSubmitting.value = false
    }
  }
</script>

<template>
  <div class="mx-auto max-w-sm">
    <UForm
      :schema="schema"
      :state="state"
      :validate-on-input-delay="0"
      class="space-y-4"
      @submit="submit"
    >
      <header>
        <h1 class="text-2xl">Set a new password</h1>
      </header>

      <UFormField label="New password" name="password" required>
        <AuthPasswordField v-model="state.password" autocomplete="new-password" />
        <AuthPasswordRequirements :password="state.password ?? ''" />
      </UFormField>

      <UFormField label="Repeat it" name="passwordConfirmation" required>
        <AuthPasswordField v-model="state.passwordConfirmation" autocomplete="new-password" />
      </UFormField>

      <UButton type="submit" :loading="isSubmitting" :disabled="!isComplete" color="primary" block>
        Save password
      </UButton>
    </UForm>
  </div>
</template>
