<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const { refresh } = useSession()
  const toast = useToast()
  const route = useRoute()
  const isSubmitting = ref(false)

  const schema = z.object({
    email: z.string().email('That does not look like an email address.'),
    password: z.string().min(1, 'Enter your password.'),
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
        title: 'Could not sign in',
        description:
          (error as { data?: { message?: string } }).data?.message ??
          'Check your details and try again.',
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
      <h1 class="text-2xl">Sign in</h1>
    </header>

    <UFormField label="Email" name="email" required>
      <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
    </UFormField>

    <UFormField label="Password" name="password" required>
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
        Forgotten your password?
      </NuxtLink>
    </p>

    <UButton type="submit" :loading="isSubmitting" :disabled="!isComplete" color="primary" block>
      Sign in
    </UButton>

    <p class="text-sm text-ink-500 dark:text-paper-400">
      No account yet?
      <NuxtLink
        to="/register"
        class="text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
      >
        Create one
      </NuxtLink>
    </p>
  </UForm>
</template>
