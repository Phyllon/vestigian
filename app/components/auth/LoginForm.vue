<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const { refresh } = useSession()
  const toast = useToast()
  const route = useRoute()
  const { t } = useI18n()
  const isSubmitting = ref(false)

  const schema = z.object({
    email: z.string().email(t('auth.login.errorEmail')),
    password: z.string().min(1, t('auth.login.errorPassword')),
  })

  type CredentialsState = z.output<typeof schema>

  const state = reactive<Partial<CredentialsState>>({ email: '', password: '' })

  /**
   * Deliberately only checks that the two fields are filled in and that the
   * address is well formed. The password policy is not applied here: an
   * account made before a rule existed must still be able to sign in.
   */
  const isComplete = computed(() => schema.safeParse(state).success)

  const signIn = async (event: FormSubmitEvent<CredentialsState>): Promise<void> => {
    isSubmitting.value = true
    try {
      await $fetch('/api/auth/login', { method: 'POST', body: event.data })
      await refresh()
      await navigateTo((route.query.next as string) || '/')
    } catch (error) {
      toast.add({
        title: t('auth.login.failedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('auth.login.failedDescription'),
        color: 'error',
      })
    } finally {
      isSubmitting.value = false
    }
  }
</script>

<template>
  <UForm :schema="schema" :state="state" class="space-y-4" @submit="signIn">
    <header>
      <h1 class="text-2xl">{{ t('auth.login.title') }}</h1>
    </header>

    <UFormField :label="t('auth.login.email')" name="email" required>
      <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
    </UFormField>

    <UFormField :label="t('auth.login.password')" name="password" required>
      <UInput
        v-model="state.password"
        type="password"
        autocomplete="current-password"
        class="w-full"
      />
    </UFormField>

    <p class="-mt-2 text-right">
      <NuxtLink
        to="/forgot-password"
        class="text-sm text-ink-500 underline underline-offset-2 dark:text-paper-400"
      >
        {{ t('auth.login.forgotPassword') }}
      </NuxtLink>
    </p>

    <UButton type="submit" :loading="isSubmitting" :disabled="!isComplete" color="primary" block>
      {{ t('auth.login.submit') }}
    </UButton>

    <p class="text-sm text-ink-500 dark:text-paper-400">
      {{ t('auth.login.noAccount') }}
      <NuxtLink
        to="/register"
        class="text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        {{ t('auth.login.createOne') }}
      </NuxtLink>
    </p>
  </UForm>
</template>
