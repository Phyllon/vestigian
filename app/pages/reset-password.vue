<script setup lang="ts">
  import { z } from 'zod'
  import { passwordSchema } from '#shared/utils/password'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const { t } = useI18n()

  definePageMeta({ layout: 'reading' })
  useHead({ title: t('resetPasswordPage.title') })
  useNoIndex()

  const route = useRoute()
  const toast = useToast()
  const isSubmitting = ref(false)

  const schema = z
    .object({
      password: passwordSchema,
      passwordConfirmation: z.string(),
    })
    .refine((values) => values.password === values.passwordConfirmation, {
      message: t('resetPasswordPage.passwordMismatch'),
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
      toast.add({ title: t('resetPasswordPage.changed'), color: 'success' })
      await navigateTo('/login')
    } catch (error) {
      toast.add({
        title: t('resetPasswordPage.resetFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('resetPasswordPage.askForNewLink'),
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
      method="post"
      :schema="schema"
      :state="state"
      :validate-on-input-delay="0"
      class="space-y-4"
      @submit="submit"
    >
      <header>
        <h1 class="text-2xl">{{ t('resetPasswordPage.title') }}</h1>
      </header>

      <UFormField :label="t('resetPasswordPage.newPassword')" name="password" required>
        <AuthPasswordField v-model="state.password" purpose="new" />
        <AuthPasswordRequirements :password="state.password ?? ''" />
      </UFormField>

      <UFormField :label="t('resetPasswordPage.repeatIt')" name="passwordConfirmation" required>
        <AuthPasswordField v-model="state.passwordConfirmation" purpose="new" />
      </UFormField>

      <UButton type="submit" :loading="isSubmitting" :disabled="!isComplete" color="primary" block>
        {{ t('resetPasswordPage.savePassword') }}
      </UButton>
    </UForm>
  </div>
</template>
