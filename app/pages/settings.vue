<script setup lang="ts">
  /**
   * Account settings. Three groups, in the order they differ in consequence:
   * how you appear, what reaches you, and the two credentials.
   *
   * The credentials are last and each asks for the current password, because a
   * session is proof of a past sign-in and not of present possession — see the
   * docstrings on `auth/change-password.post.ts` and `auth/change-email.post.ts`.
   */
  import { passwordSchema } from '#shared/utils/password'

  const { t } = useI18n()
  const toast = useToast()
  const { refresh: refreshSession } = useSession()
  const { locale, availableLocales, setLocale } = useUiLocale()

  const { data: account, refresh } = await useFetch('/api/me')

  const displayName = ref('')
  const bio = ref('')
  const publicProfile = ref(false)
  const notifyByEmail = ref(true)
  const isSavingProfile = ref(false)

  watchEffect(() => {
    if (!account.value) return
    displayName.value = account.value.account.displayName
    bio.value = account.value.account.bio ?? ''
    publicProfile.value = account.value.account.publicProfile
    notifyByEmail.value = account.value.account.notifyByEmail
  })

  const saveProfile = async (): Promise<void> => {
    isSavingProfile.value = true
    try {
      await $fetch('/api/me', {
        method: 'PATCH',
        body: {
          displayName: displayName.value.trim(),
          bio: bio.value.trim() || null,
          publicProfile: publicProfile.value,
          notifyByEmail: notifyByEmail.value,
          preferredLocale: locale.value,
        },
      })
      // The header reads the display name from the sealed session, which the
      // endpoint re-seals on a rename; this pulls the new one into the client.
      await Promise.all([refreshSession(), refresh()])
      toast.add({ title: t('settings.saved'), color: 'success' })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      toast.add({
        title: status === 409 ? t('settings.nameTaken') : t('settings.saveFailed'),
        color: 'error',
      })
    } finally {
      isSavingProfile.value = false
    }
  }

  const currentPassword = ref('')
  const newPassword = ref('')
  const isChangingPassword = ref(false)

  const passwordProblems = computed(() => {
    if (newPassword.value.length === 0) return []
    const result = passwordSchema.safeParse(newPassword.value)
    return result.success ? [] : result.error.issues.map((issue) => issue.message)
  })

  const changePassword = async (): Promise<void> => {
    isChangingPassword.value = true
    try {
      await $fetch('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: currentPassword.value, password: newPassword.value },
      })
      currentPassword.value = ''
      newPassword.value = ''
      toast.add({ title: t('settings.passwordChanged'), color: 'success' })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      toast.add({
        title: status === 403 ? t('settings.wrongPassword') : t('settings.passwordFailed'),
        color: 'error',
      })
    } finally {
      isChangingPassword.value = false
    }
  }

  const emailPassword = ref('')
  const newEmail = ref('')
  const isChangingEmail = ref(false)

  const changeEmail = async (): Promise<void> => {
    isChangingEmail.value = true
    try {
      await $fetch('/api/auth/change-email', {
        method: 'POST',
        body: { currentPassword: emailPassword.value, email: newEmail.value.trim() },
      })
      emailPassword.value = ''
      newEmail.value = ''
      toast.add({ title: t('settings.emailPending'), color: 'success' })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      let title = t('settings.emailFailed')
      if (status === 403) title = t('settings.wrongPassword')
      else if (status === 409) title = t('settings.emailTaken')
      toast.add({ title, color: 'error' })
    } finally {
      isChangingEmail.value = false
    }
  }

  const onLocaleChange = async (code: string): Promise<void> => {
    await setLocale(code)
  }

  /**
   * Two-factor authentication. Sits between the password and email forms —
   * also a credential, and the enable/disable/regenerate calls below all ask
   * for the current password for the same reason those two do.
   *
   * Backup codes are the one thing this section shows only once: `enable`
   * and `regenerateBackupCodes` each return them in the response and
   * nowhere else ever will, so `backupCodes` is cleared the moment the
   * reader acknowledges having saved them rather than kept around in memory
   * longer than it has to be.
   */
  const isTwoFactorEnabled = computed(() => account.value?.account.totpEnabledAt != null)
  const isEnrolling = ref(false)
  const isStartingEnrollment = ref(false)
  const isConfirmingEnrollment = ref(false)
  const enrollmentQrCode = ref('')
  const enrollmentSecret = ref('')
  const confirmCode = ref('')
  const backupCodes = ref<string[] | null>(null)

  const disablePassword = ref('')
  const disableCode = ref('')
  const isDisabling = ref(false)

  const regeneratePassword = ref('')
  const isRegenerating = ref(false)

  const startEnrollment = async (): Promise<void> => {
    isStartingEnrollment.value = true
    try {
      const response = await $fetch('/api/auth/2fa/setup', { method: 'POST' })
      enrollmentQrCode.value = response.qrCode
      enrollmentSecret.value = response.secret
      isEnrolling.value = true
    } catch {
      toast.add({ title: t('settings.twoFactor.setupFailed'), color: 'error' })
    } finally {
      isStartingEnrollment.value = false
    }
  }

  const cancelEnrollment = (): void => {
    isEnrolling.value = false
    confirmCode.value = ''
    enrollmentQrCode.value = ''
    enrollmentSecret.value = ''
  }

  const confirmEnrollment = async (): Promise<void> => {
    isConfirmingEnrollment.value = true
    try {
      const response = await $fetch('/api/auth/2fa/enable', {
        method: 'POST',
        body: { code: confirmCode.value.trim() },
      })
      backupCodes.value = response.backupCodes
      cancelEnrollment()
      await Promise.all([refreshSession(), refresh()])
      toast.add({ title: t('settings.twoFactor.enabled'), color: 'success' })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      toast.add({
        title:
          status === 403 ? t('settings.twoFactor.wrongCode') : t('settings.twoFactor.setupFailed'),
        color: 'error',
      })
    } finally {
      isConfirmingEnrollment.value = false
    }
  }

  const disableTwoFactor = async (): Promise<void> => {
    isDisabling.value = true
    try {
      await $fetch('/api/auth/2fa/disable', {
        method: 'POST',
        body: { currentPassword: disablePassword.value, code: disableCode.value.trim() },
      })
      disablePassword.value = ''
      disableCode.value = ''
      await Promise.all([refreshSession(), refresh()])
      toast.add({ title: t('settings.twoFactor.disabled'), color: 'success' })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      toast.add({
        title: status === 403 ? t('settings.wrongPassword') : t('settings.twoFactor.disableFailed'),
        color: 'error',
      })
    } finally {
      isDisabling.value = false
    }
  }

  const regenerateBackupCodes = async (): Promise<void> => {
    isRegenerating.value = true
    try {
      const response = await $fetch('/api/auth/2fa/backup-codes', {
        method: 'POST',
        body: { currentPassword: regeneratePassword.value },
      })
      backupCodes.value = response.backupCodes
      regeneratePassword.value = ''
      toast.add({ title: t('settings.twoFactor.backupCodesRegenerated'), color: 'success' })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      toast.add({
        title: status === 403 ? t('settings.wrongPassword') : t('settings.twoFactor.disableFailed'),
        color: 'error',
      })
    } finally {
      isRegenerating.value = false
    }
  }

  const acknowledgeBackupCodes = (): void => {
    backupCodes.value = null
  }

  const copyBackupCodes = async (): Promise<void> => {
    if (!backupCodes.value) return
    try {
      await navigator.clipboard.writeText(backupCodes.value.join('\n'))
      toast.add({ title: t('settings.twoFactor.copied'), color: 'success' })
    } catch {
      toast.add({ title: t('settings.twoFactor.copyFailed'), color: 'error' })
    }
  }

  /**
   * A `Blob` built and downloaded entirely client-side — the codes never
   * make a second trip to any server, this app's own included. `<a
   * download>` inside an artifact viewer sandbox is inert, but this is a
   * real page in a real browser, where the pattern works as the platform
   * intends.
   */
  const downloadBackupCodes = (): void => {
    if (!backupCodes.value) return
    const blob = new Blob([`${backupCodes.value.join('\n')}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'vestigian-backup-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Explicit ids for every `UFormField`-wrapped control below, rather than
   * Nuxt UI's own `useId()`-generated ones.
   *
   * `reading.vue`'s header mounts `LanguageSwitcher`, `ThemeToggle` and
   * `AccountMenu` inside `ClientOnly`, so each renders an inert placeholder
   * during SSR and only calls its own `useId()` (via its `UDropdownMenu`)
   * once mounted client-side. That shifts how many `useId()` slots are
   * already spent by the time this page's `UFormField`s reserve theirs,
   * server versus client — axe caught the result: the input's `id` attribute
   * got corrected to the client's value, but the `aria-describedby` and
   * `<label for>` pointing at it were left holding the server's, so six
   * fields on this page — display name, bio, both password fields, the new
   * address, and the second current-password field — had no accessible name
   * at all once hydrated. A static id sidesteps the mismatch outright.
   */
  useHead({ title: t('settings.title') })
  useNoIndex()

  definePageMeta({ layout: 'reading', middleware: 'authenticated' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('settings.title') }}
    </h1>
    <p class="mt-3 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('settings.intro') }}
    </p>

    <form method="post" class="mt-8 space-y-5" @submit.prevent="saveProfile">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('settings.profileHeading') }}
      </h2>

      <UFormField :label="t('settings.displayName')" :help="t('settings.displayNameHelp')">
        <UInput
          id="settings-display-name"
          v-model="displayName"
          autocomplete="nickname"
          maxlength="60"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('settings.bio')" :help="t('settings.bioHelp')">
        <UTextarea id="settings-bio" v-model="bio" :rows="3" maxlength="280" class="w-full" />
      </UFormField>

      <UFormField :label="t('settings.language')" :help="t('settings.languageHelp')">
        <USelectMenu
          :model-value="locale"
          :items="availableLocales.map((entry) => ({ label: entry.name, value: entry.code }))"
          value-key="value"
          class="w-full"
          @update:model-value="onLocaleChange"
        />
      </UFormField>

      <UCheckbox v-model="publicProfile" :label="t('settings.publicProfile')">
        <template #description>
          {{ t('settings.publicProfileHelp') }}
          <NuxtLink
            v-if="publicProfile && displayName"
            :to="`/contributor/${encodeURIComponent(displayName)}`"
            class="underline"
          >
            {{ t('settings.publicProfileLink') }}
          </NuxtLink>
        </template>
      </UCheckbox>

      <UCheckbox
        v-model="notifyByEmail"
        :label="t('settings.notifyByEmail')"
        :description="t('settings.notifyByEmailHelp')"
      />

      <UButton type="submit" :loading="isSavingProfile">{{ t('settings.save') }}</UButton>
    </form>

    <form
      method="post"
      class="mt-10 space-y-5 border-t border-paper-200 pt-6 dark:border-night-700"
      @submit.prevent="changePassword"
    >
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('settings.passwordHeading') }}
      </h2>
      <p class="text-sm text-ink-600 dark:text-paper-300">{{ t('settings.passwordBody') }}</p>

      <UFormField :label="t('settings.currentPassword')">
        <AuthPasswordField
          id="settings-password-current"
          v-model="currentPassword"
          purpose="current"
        />
      </UFormField>

      <UFormField :label="t('settings.newPassword')">
        <AuthPasswordField id="settings-password-new" v-model="newPassword" purpose="new" />
      </UFormField>

      <AuthPasswordRequirements v-if="newPassword" :password="newPassword" />

      <UButton
        type="submit"
        :loading="isChangingPassword"
        :disabled="!currentPassword || passwordProblems.length > 0"
      >
        {{ t('settings.changePassword') }}
      </UButton>
    </form>

    <section class="mt-10 space-y-5 border-t border-paper-200 pt-6 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('settings.twoFactor.heading') }}
      </h2>
      <p class="text-sm text-ink-600 dark:text-paper-300">{{ t('settings.twoFactor.body') }}</p>

      <!-- The codes, shown exactly once, from either enabling or regenerating. -->
      <div v-if="backupCodes" class="leaf space-y-4 p-4">
        <p class="text-sm font-medium text-ink-900 dark:text-paper-100">
          {{ t('settings.twoFactor.backupCodesIntro') }}
        </p>
        <ul class="grid grid-cols-2 gap-2 font-mono text-sm text-ink-800 dark:text-paper-200">
          <li v-for="backupCode in backupCodes" :key="backupCode" class="datum">
            {{ backupCode }}
          </li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <UButton color="neutral" variant="outline" icon="i-lucide-copy" @click="copyBackupCodes">
            {{ t('settings.twoFactor.copyCodes') }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-download"
            @click="downloadBackupCodes"
          >
            {{ t('settings.twoFactor.downloadCodes') }}
          </UButton>
        </div>
        <UButton color="primary" @click="acknowledgeBackupCodes">
          {{ t('settings.twoFactor.savedCodes') }}
        </UButton>
      </div>

      <!-- Off, and not mid-enrollment. -->
      <UButton
        v-else-if="!isTwoFactorEnabled && !isEnrolling"
        :loading="isStartingEnrollment"
        icon="i-lucide-shield-plus"
        @click="startEnrollment"
      >
        {{ t('settings.twoFactor.enable') }}
      </UButton>

      <!-- Enrolling: scan, then confirm with a live code. -->
      <div v-else-if="isEnrolling" class="space-y-4">
        <p class="text-sm text-ink-600 dark:text-paper-300">
          {{ t('settings.twoFactor.scanIntro') }}
        </p>
        <img
          :src="enrollmentQrCode"
          :alt="t('settings.twoFactor.qrAlt')"
          class="leaf h-48 w-48"
          width="192"
          height="192"
        />
        <p class="font-mono text-xs text-ink-500 dark:text-paper-400">
          {{ t('settings.twoFactor.manualKey') }}: {{ enrollmentSecret }}
        </p>

        <UFormField :label="t('settings.twoFactor.confirmCode')">
          <UInput
            id="settings-2fa-confirm-code"
            v-model="confirmCode"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            class="w-full font-mono tracking-widest"
          />
        </UFormField>

        <div class="flex gap-2">
          <UButton
            :loading="isConfirmingEnrollment"
            :disabled="confirmCode.trim().length !== 6"
            @click="confirmEnrollment"
          >
            {{ t('settings.twoFactor.confirm') }}
          </UButton>
          <UButton color="neutral" variant="ghost" @click="cancelEnrollment">
            {{ t('settings.cancel') }}
          </UButton>
        </div>
      </div>

      <!-- On: disable, or regenerate the backup codes. -->
      <template v-else>
        <p class="datum flex items-center gap-2 text-sm text-verdigris-700 dark:text-verdigris-300">
          <UIcon name="i-lucide-shield-check" class="size-4" aria-hidden="true" />
          {{ t('settings.twoFactor.isOn') }}
        </p>

        <form method="post" class="space-y-4" @submit.prevent="regenerateBackupCodes">
          <h3 class="font-medium text-ink-900 dark:text-paper-100">
            {{ t('settings.twoFactor.regenerateHeading') }}
          </h3>
          <UFormField :label="t('settings.currentPassword')">
            <AuthPasswordField
              id="settings-2fa-regenerate-password"
              v-model="regeneratePassword"
              purpose="current"
            />
          </UFormField>
          <UButton
            type="submit"
            color="neutral"
            variant="outline"
            :loading="isRegenerating"
            :disabled="!regeneratePassword"
          >
            {{ t('settings.twoFactor.regenerate') }}
          </UButton>
        </form>

        <form method="post" class="space-y-4" @submit.prevent="disableTwoFactor">
          <h3 class="font-medium text-ink-900 dark:text-paper-100">
            {{ t('settings.twoFactor.disableHeading') }}
          </h3>
          <UFormField :label="t('settings.currentPassword')">
            <AuthPasswordField
              id="settings-2fa-disable-password"
              v-model="disablePassword"
              purpose="current"
            />
          </UFormField>
          <UFormField :label="t('settings.twoFactor.confirmCode')">
            <UInput
              id="settings-2fa-disable-code"
              v-model="disableCode"
              autocomplete="one-time-code"
              class="w-full font-mono tracking-widest"
            />
          </UFormField>
          <UButton
            type="submit"
            color="error"
            variant="outline"
            :loading="isDisabling"
            :disabled="!disablePassword || !disableCode"
          >
            {{ t('settings.twoFactor.disable') }}
          </UButton>
        </form>
      </template>
    </section>

    <form
      method="post"
      class="mt-10 space-y-5 border-t border-paper-200 pt-6 dark:border-night-700"
      @submit.prevent="changeEmail"
    >
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('settings.emailHeading') }}
      </h2>
      <p class="text-sm text-ink-600 dark:text-paper-300">{{ t('settings.emailBody') }}</p>
      <p v-if="account" class="datum text-sm text-ink-800 dark:text-paper-100">
        {{ account.account.email }}
      </p>

      <UFormField :label="t('settings.newEmail')">
        <UInput
          id="settings-email-new"
          v-model="newEmail"
          type="email"
          autocomplete="email"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('settings.currentPassword')">
        <AuthPasswordField id="settings-email-password" v-model="emailPassword" purpose="current" />
      </UFormField>

      <UButton type="submit" :loading="isChangingEmail" :disabled="!newEmail || !emailPassword">
        {{ t('settings.changeEmail') }}
      </UButton>
    </form>

    <section class="mt-10 border-t border-paper-200 pt-6 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('settings.dataHeading') }}
      </h2>
      <p class="mt-2 text-sm text-ink-600 dark:text-paper-300">{{ t('settings.dataBody') }}</p>
      <UButton
        to="/privacy"
        class="mt-3"
        color="neutral"
        variant="outline"
        icon="i-lucide-shield-check"
      >
        {{ t('settings.dataAction') }}
      </UButton>
    </section>
  </article>
</template>
