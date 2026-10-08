<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const { refresh } = useSession()
  const toast = useToast()
  const route = useRoute()
  const { t } = useI18n()
  const isSubmitting = ref(false)

  /**
   * One notice per step, because the two limits are separate policies on the
   * server (`login`, `twoFactorVerify`): being paused on one must not leave the
   * other looking paused when someone goes back a step.
   */
  const signInNotice = useRateLimitNotice()
  const verifyNotice = useRateLimitNotice()
  const { isPaused: isSignInPaused, lockedFor: signInLockedFor } = signInNotice
  const { isPaused: isVerifyPaused, lockedFor: verifyLockedFor } = verifyNotice

  /** Attempts left on this connection, from the last refused sign-in. */
  const attemptsRemaining = ref<number | null>(null)
  const showAttemptsWarning = computed(() => shouldWarnAboutAttempts(attemptsRemaining.value))

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

  /**
   * A second step, not a second page. `/api/auth/login` answers
   * `{ requiresTwoFactor: true, challengeId }` — a 200, not an error — for an
   * account with 2FA on, so this form swaps its own body rather than
   * navigating anywhere; the credentials already entered stay exactly where
   * they were if the reader needs to go back.
   */
  const challengeId = ref<string | null>(null)
  const code = ref('')
  const useBackupCode = ref(false)
  const isVerifying = ref(false)

  interface LoginResponse {
    requiresTwoFactor?: true
    challengeId?: string
  }

  const signIn = async (event: FormSubmitEvent<CredentialsState>): Promise<void> => {
    isSubmitting.value = true
    try {
      const response = await $fetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: event.data,
      })

      if (response.requiresTwoFactor && response.challengeId) {
        challengeId.value = response.challengeId
        return
      }

      await refresh()
      toast.add({ title: t('auth.login.successTitle'), color: 'success' })
      await navigateTo((route.query.next as string) || '/')
    } catch (error) {
      if (signInNotice.handle(error)) {
        attemptsRemaining.value = null
        return
      }

      attemptsRemaining.value = readAttemptsRemaining(error)
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

  const verifyCode = async (): Promise<void> => {
    if (!challengeId.value) return
    isVerifying.value = true
    try {
      await $fetch('/api/auth/verify-2fa', {
        method: 'POST',
        body: { challengeId: challengeId.value, code: code.value.trim() },
      })
      await refresh()
      toast.add({ title: t('auth.login.successTitle'), color: 'success' })
      await navigateTo((route.query.next as string) || '/')
    } catch (error) {
      if (verifyNotice.handle(error)) return

      toast.add({
        title: t('auth.login.twoFactor.failedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('auth.login.twoFactor.failedDescription'),
        color: 'error',
      })
      code.value = ''
    } finally {
      isVerifying.value = false
    }
  }

  /** Back to the credentials step, rather than reloading the page. */
  const cancelTwoFactor = (): void => {
    challengeId.value = null
    code.value = ''
    useBackupCode.value = false
  }
</script>

<template>
  <!--
    `method="post"` is load-bearing, not decoration. UForm renders a bare
    `<form>` whose only submit handling is `@submit.prevent`, so a submission
    that happens *before* Vue hydrates — slow mobile network, a blocked bundle,
    or autofill firing Enter early — falls through to the browser default, which
    is GET. That serialises every field into the query string: this form's
    password would land in the address bar, browser history, the Referer header
    of the next request, and every access log between here and the origin.
    Posting instead means a pre-hydration submit is at worst a failed request.
    Fixed upstream in @nuxt/ui 4.8.1 (GHSA-gj2h-2fpw-fhv9); this is that fix
    applied by hand, because the upgrade is a major version of the whole design
    system and this one line does not need to wait for it.
  -->
  <UForm
    v-if="!challengeId"
    :schema="schema"
    :state="state"
    method="post"
    class="space-y-4"
    @submit="signIn"
  >
    <header>
      <h1 class="text-2xl">{{ t('auth.login.title') }}</h1>
    </header>

    <UFormField :label="t('auth.login.email')" name="email" required>
      <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
    </UFormField>

    <UFormField :label="t('auth.login.password')" name="password" required>
      <AuthPasswordField v-model="state.password" purpose="current" />
    </UFormField>

    <p class="-mt-2 text-right">
      <NuxtLink
        to="/forgot-password"
        class="text-sm text-ink-500 underline underline-offset-2 dark:text-paper-400"
      >
        {{ t('auth.login.forgotPassword') }}
      </NuxtLink>
    </p>

    <UiRateLimitAlert
      v-if="isSignInPaused"
      :locked-for="signInLockedFor"
      :description="t('auth.login.rateLimited.description', { wait: signInLockedFor })"
    />
    <UAlert
      v-else-if="showAttemptsWarning"
      role="status"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :description="t('auth.login.rateLimited.remaining', attemptsRemaining ?? 0)"
    />

    <UButton
      type="submit"
      :loading="isSubmitting"
      :disabled="!isComplete || isSignInPaused"
      color="primary"
      block
    >
      {{ isSignInPaused ? signInNotice.waitingLabel.value : t('auth.login.submit') }}
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

  <!--
    The password already checked out — `challengeId` only exists because
    `/api/auth/login` returned it — so this step asks for the second factor
    only, not the whole form again.

    `method="post"` for the same reason as the form above: this one is
    hand-written rather than a UForm, but it has the identical shape — a bare
    `<form>` guarded only by `@submit.prevent` — so a pre-hydration submit would
    put a live TOTP code, or a single-use backup code, into the query string.
  -->
  <form v-else method="post" class="space-y-4" @submit.prevent="verifyCode">
    <header>
      <h1 class="text-2xl">{{ t('auth.login.twoFactor.title') }}</h1>
      <p class="mt-1 text-sm text-ink-600 dark:text-paper-300">
        {{
          useBackupCode
            ? t('auth.login.twoFactor.introBackup')
            : t('auth.login.twoFactor.introCode')
        }}
      </p>
    </header>

    <UFormField
      :label="useBackupCode ? t('auth.login.twoFactor.backupCode') : t('auth.login.twoFactor.code')"
    >
      <UInput
        id="login-2fa-code"
        v-model="code"
        :inputmode="useBackupCode ? 'text' : 'numeric'"
        :maxlength="useBackupCode ? 9 : 6"
        autocomplete="one-time-code"
        class="w-full font-mono tracking-widest"
      />
    </UFormField>

    <UiRateLimitAlert
      v-if="isVerifyPaused"
      :locked-for="verifyLockedFor"
      :description="t('auth.login.rateLimited.twoFactorDescription', { wait: verifyLockedFor })"
    />

    <UButton
      type="submit"
      :loading="isVerifying"
      :disabled="code.trim().length === 0 || isVerifyPaused"
      color="primary"
      block
    >
      {{ isVerifyPaused ? verifyNotice.waitingLabel.value : t('auth.login.twoFactor.submit') }}
    </UButton>

    <div class="flex items-center justify-between text-sm">
      <button
        type="button"
        class="text-ink-500 underline underline-offset-2 dark:text-paper-400"
        @click="useBackupCode = !useBackupCode"
      >
        {{
          useBackupCode
            ? t('auth.login.twoFactor.useCodeInstead')
            : t('auth.login.twoFactor.useBackupInstead')
        }}
      </button>
      <button
        type="button"
        class="text-ink-500 underline underline-offset-2 dark:text-paper-400"
        @click="cancelTwoFactor"
      >
        {{ t('auth.login.twoFactor.startOver') }}
      </button>
    </div>
  </form>
</template>
