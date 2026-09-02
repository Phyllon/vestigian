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
      toast.add({
        title:
          status === 403
            ? t('settings.wrongPassword')
            : status === 409
              ? t('settings.emailTaken')
              : t('settings.emailFailed'),
        color: 'error',
      })
    } finally {
      isChangingEmail.value = false
    }
  }

  const onLocaleChange = async (code: string): Promise<void> => {
    await setLocale(code)
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

    <form class="mt-8 space-y-5" @submit.prevent="saveProfile">
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

      <UFormField :label="t('settings.language')">
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
          autocomplete="current-password"
        />
      </UFormField>

      <UFormField :label="t('settings.newPassword')">
        <AuthPasswordField
          id="settings-password-new"
          v-model="newPassword"
          autocomplete="new-password"
        />
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

    <form
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
        <AuthPasswordField
          id="settings-email-password"
          v-model="emailPassword"
          autocomplete="current-password"
        />
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
