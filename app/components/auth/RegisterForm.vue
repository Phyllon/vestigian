<script setup lang="ts">
  import { z } from 'zod'
  import { passwordSchema } from '#shared/utils/password'
  import type { Form, FormSubmitEvent } from '@nuxt/ui'

  const toast = useToast()
  const form = useTemplateRef<Form<RegistrationState>>('form')
  const turnstileToken = ref('')
  const isSubmitting = ref(false)
  const isDone = ref(false)

  const schema = z
    .object({
      displayName: z.string().trim().min(3, 'At least three characters.').max(60),
      email: z.string().email('That does not look like an email address.'),
      password: passwordSchema,
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

  /**
   * Gates the submit button. The schema covers every field including the
   * confirmation match, so this is the same judgement the form itself makes on
   * submit — the button simply refuses to offer an action that would fail.
   */
  const isComplete = computed(() => schema.safeParse(state).success)

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
      const response = (error as { data?: { message?: string; data?: { field?: string } } }).data
      const message = response?.message ?? 'Try again shortly.'

      /**
       * A conflict names the field it came from, so the message lands under
       * the input that has to change rather than in a toast the reader has to
       * hold in their head while they retype. The form keeps everything else
       * they entered; only the offending field needs a second attempt.
       */
      if (response?.data?.field) {
        // No second argument: submit only runs once the form validated, so
        // there is no other error to preserve, and the field name coming back
        // from the server is a plain string rather than a key of the schema.
        form.value?.setErrors([{ name: response.data.field, message }])
        return
      }

      toast.add({ title: 'Registration failed', description: message, color: 'error' })
    } finally {
      isSubmitting.value = false
    }
  }
</script>

<template>
  <div v-if="isDone" class="leaf p-6">
    <h1 class="text-xl">Check your inbox</h1>
    <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
      Confirm your address to finish setting up the account. The link is good for one day.
    </p>
  </div>

  <!-- No debounce: the requirement list has to answer the keystroke that changed it. -->
  <UForm
    v-else
    ref="form"
    :schema="schema"
    :state="state"
    :validate-on-input-delay="0"
    class="space-y-4"
    @submit="register"
  >
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

    <UFormField label="Password" name="password" required>
      <AuthPasswordField v-model="state.password" autocomplete="new-password" />
      <AuthPasswordRequirements :password="state.password ?? ''" />
    </UFormField>

    <UFormField label="Repeat password" name="passwordConfirmation" required>
      <AuthPasswordField v-model="state.passwordConfirmation" autocomplete="new-password" />
    </UFormField>

    <!-- Kept out of the accessibility tree and off screen rather than display:none,
         which many bots now detect and skip. -->
    <div class="absolute left-[-9999px]" aria-hidden="true">
      <label
        >Website<input v-model="state.website" type="text" tabindex="-1" autocomplete="off"
      /></label>
    </div>

    <NuxtTurnstile v-model="turnstileToken" />

    <UButton type="submit" :loading="isSubmitting" :disabled="!isComplete" color="primary" block>
      Create account
    </UButton>
  </UForm>
</template>
