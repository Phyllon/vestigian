<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const toast = useToast()
  const turnstileToken = ref('')
  const isSubmitting = ref(false)
  const isDone = ref(false)

  const schema = z
    .object({
      displayName: z.string().trim().min(3, 'At least three characters.').max(60),
      email: z.string().email('That does not look like an email address.'),
      password: z.string().min(12, 'Use at least twelve characters.'),
      passwordConfirmation: z.string(),
      /** Honeypot — hidden from people, irresistible to bots. */
      website: z.string().max(0).optional(),
    })
    .refine((values) => values.password === values.passwordConfirmation, {
      message: 'The two passwords do not match.',
      path: ['passwordConfirmation'],
    })

  type RegistrationState = z.output<typeof schema>

  const state = reactive<Partial<RegistrationState>>({
    displayName: '',
    email: '',
    password: '',
    passwordConfirmation: '',
    website: '',
  })

  const register = async (event: FormSubmitEvent<RegistrationState>): Promise<void> => {
    isSubmitting.value = true
    try {
      await $fetch('/api/auth/register', {
        method: 'POST',
        body: {
          displayName: event.data.displayName,
          email: event.data.email,
          password: event.data.password,
          website: event.data.website,
          turnstileToken: turnstileToken.value,
        },
      })
      isDone.value = true
    } catch (error) {
      toast.add({
        title: 'Registration failed',
        description:
          (error as { data?: { message?: string } }).data?.message ?? 'Try again shortly.',
        color: 'error',
      })
    } finally {
      isSubmitting.value = false
    }
  }
</script>

<template>
  <div v-if="isDone" class="leaf leaf-margin py-6 pr-6">
    <h1 class="text-xl">Check your inbox</h1>
    <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
      Confirm your address to finish setting up the account. The link is good for one day.
    </p>
  </div>

  <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="register">
    <header>
      <h1 class="text-2xl">Join Vestigia</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        Your first two contributions are checked by a moderator. After that they publish as you
        write them.
      </p>
    </header>

    <UFormField label="Display name" name="displayName" required>
      <UInput v-model="state.displayName" autocomplete="nickname" class="w-full" />
    </UFormField>

    <UFormField label="Email" name="email" required>
      <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
    </UFormField>

    <UFormField label="Password" name="password" hint="Twelve characters or more" required>
      <UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
    </UFormField>

    <UFormField label="Repeat password" name="passwordConfirmation" required>
      <UInput
        v-model="state.passwordConfirmation"
        type="password"
        autocomplete="new-password"
        class="w-full"
      />
    </UFormField>

    <!-- Kept out of the accessibility tree and off screen rather than display:none,
         which many bots now detect and skip. -->
    <div class="absolute left-[-9999px]" aria-hidden="true">
      <label
        >Website<input v-model="state.website" type="text" tabindex="-1" autocomplete="off"
      /></label>
    </div>

    <NuxtTurnstile v-model="turnstileToken" />

    <UButton type="submit" :loading="isSubmitting" color="primary" block>Create account</UButton>
  </UForm>
</template>
