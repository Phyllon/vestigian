<script setup lang="ts">
  import { z } from 'zod'
  import { passwordSchema } from '#shared/utils/password'
  import type { Form, FormSubmitEvent } from '@nuxt/ui'

  const toast = useToast()
  const { t } = useI18n()
  const form = useTemplateRef<Form<RegistrationState>>('form')
  const altchaWidget = useTemplateRef<HTMLElement & { reset?: () => void }>('altchaWidget')
  const altchaPayload = ref('')
  const isSubmitting = ref(false)
  const isDone = ref(false)

  const schema = z
    .object({
      displayName: z.string().trim().min(3, t('auth.register.errorDisplayName')).max(60),
      email: z.string().email(t('auth.register.errorEmail')),
      password: passwordSchema,
      passwordConfirmation: z.string(),
      /** Honeypot — hidden from people, irresistible to bots. */
      website: z.string().max(0).optional(),
    })
    .refine((values) => values.password === values.passwordConfirmation, {
      message: t('auth.register.errorPasswordMismatch'),
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
  const isComplete = computed(() => schema.safeParse(state).success && altchaPayload.value !== '')

  /**
   * A solution is spent once the server accepts it, and the server refuses a
   * replay. Without this the widget would keep offering the same used payload,
   * so every retry after a failure failed again for a reason invisible to the
   * person retrying.
   */
  const resetChallenge = (): void => {
    altchaPayload.value = ''
    altchaWidget.value?.reset?.()
  }

  const rememberSolution = (event: Event): void => {
    const detail = (event as CustomEvent<{ payload?: string; state?: string }>).detail
    altchaPayload.value = detail?.state === 'verified' ? (detail.payload ?? '') : ''
  }

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
          altcha: altchaPayload.value,
        },
      })
      isDone.value = true
    } catch (error) {
      const response = (error as { data?: { message?: string; data?: { field?: string } } }).data
      const message = response?.message ?? t('auth.register.failedDefault')

      /**
       * A conflict names the field it came from, so the message lands under
       * the input that has to change rather than in a toast the reader has to
       * hold in their head while they retype. The form keeps everything else
       * they entered; only the offending field needs a second attempt.
       */
      resetChallenge()

      if (response?.data?.field) {
        // No second argument: submit only runs once the form validated, so
        // there is no other error to preserve, and the field name coming back
        // from the server is a plain string rather than a key of the schema.
        form.value?.setErrors([{ name: response.data.field, message }])
        return
      }

      toast.add({ title: t('auth.register.failedTitle'), description: message, color: 'error' })
    } finally {
      isSubmitting.value = false
    }
  }

  /**
   * Loaded here rather than as a plugin so it stays in the register chunk —
   * a web component nothing else on the site renders. The import is dynamic
   * because `altcha` registers a custom element against `window` as a side
   * effect, which would throw during server rendering.
   */
  onMounted(async () => {
    await import('altcha')
  })
</script>

<template>
  <div v-if="isDone" class="leaf p-6" role="status">
    <h1 class="text-xl">{{ t('auth.register.doneTitle') }}</h1>
    <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
      {{ t('auth.register.doneDescription') }}
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
      <h1 class="text-2xl">{{ t('auth.register.title') }}</h1>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        {{ t('auth.register.intro') }}
      </p>
    </header>

    <UFormField :label="t('auth.register.displayName')" name="displayName" required>
      <UInput v-model="state.displayName" autocomplete="nickname" class="w-full" />
    </UFormField>

    <UFormField :label="t('auth.register.email')" name="email" required>
      <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
    </UFormField>

    <UFormField :label="t('auth.register.password')" name="password" required>
      <AuthPasswordField v-model="state.password" autocomplete="new-password" />
      <AuthPasswordRequirements :password="state.password ?? ''" />
    </UFormField>

    <UFormField
      :label="t('auth.register.passwordConfirmation')"
      name="passwordConfirmation"
      required
    >
      <AuthPasswordField v-model="state.passwordConfirmation" autocomplete="new-password" />
    </UFormField>

    <!-- Kept out of the accessibility tree and off screen rather than display:none,
         which many bots now detect and skip. -->
    <div class="absolute left-[-9999px]" aria-hidden="true">
      <label
        >Website<input v-model="state.website" type="text" tabindex="-1" autocomplete="off"
      /></label>
    </div>

    <!--
      Self-hosted proof of work, in place of Turnstile. `challenge` points at
      our own endpoint, so the signup page loads nothing from a third party and
      no visitor signal leaves the box.
    -->
    <!--
      `challenge`, not `challengeurl`. ALTCHA v3 renamed the attribute, and the
      old name is not rejected — it is ignored, so the widget silently falls
      back to fetching the form's own action. It then receives the register
      page's HTML, reports "invalid content-type", and never produces a
      payload: the submit button stays disabled and **nobody can sign up**.
      A 200 everywhere, nothing in the logs. Found by `e2e/auth.spec.ts`.
    -->
    <altcha-widget
      ref="altchaWidget"
      challenge="/api/auth/challenge"
      hidefooter
      @statechange="rememberSolution"
    />

    <UButton type="submit" :loading="isSubmitting" :disabled="!isComplete" color="primary" block>
      {{ t('auth.register.submit') }}
    </UButton>
  </UForm>
</template>
