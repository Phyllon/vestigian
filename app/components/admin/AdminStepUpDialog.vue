<script setup lang="ts">
  /**
   * The password prompt in front of a sanction.
   *
   * A modal is the right shape here and almost nowhere else in this app — the
   * account menu is explicitly `modal="false"` because it is a nav menu — since
   * this genuinely blocks: there is nothing useful to do on the page until the
   * question is answered, and a focus trap is what stops a keyboard user from
   * tabbing past the prompt into the button they just pressed.
   *
   * It never explains *why* re-authentication is needed in terms of the
   * mechanism. "Confirm it is you" is actionable; "your step-up grant has
   * expired" is a status report about an implementation detail.
   */
  const props = defineProps<{
    confirming: boolean
    error: string | null
  }>()

  const emit = defineEmits<{
    confirm: [{ currentPassword: string; code?: string }]
    cancel: []
  }>()

  const open = defineModel<boolean>('open', { required: true })

  const { t } = useI18n()
  const { currentUser } = useSession()

  const currentPassword = ref('')
  const code = ref('')

  /**
   * Always offered rather than shown only to accounts with two factors on.
   * The session cookie carries no `totpEnabledAt`, so the client cannot know —
   * and asking the server "does this account have 2FA" purely to decide
   * whether to render a field would be a worse answer than an optional field
   * the endpoint ignores when it is empty.
   */
  const submit = (): void => {
    emit('confirm', {
      currentPassword: currentPassword.value,
      code: code.value.trim() || undefined,
    })
  }

  const cancel = (): void => {
    currentPassword.value = ''
    code.value = ''
    emit('cancel')
  }

  // Cleared whenever the dialog closes, however it closed: a password left in
  // a component that is merely hidden is a password sitting in memory for the
  // rest of the session.
  watch(open, (isOpen) => {
    if (!isOpen) {
      currentPassword.value = ''
      code.value = ''
    }
  })
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('admin.stepUp.title')"
    :description="t('admin.stepUp.description')"
    @update:open="(next: boolean) => !next && cancel()"
  >
    <template #body>
      <form class="space-y-3" @submit.prevent="submit">
        <p class="text-sm text-ink-500 dark:text-paper-400">
          {{ t('admin.stepUp.explanation') }}
        </p>

        <UFormField :label="t('admin.stepUp.passwordLabel')" required>
          <UInput
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            class="w-full"
            :aria-label="t('admin.stepUp.passwordAria', { name: currentUser?.displayName ?? '' })"
          />
        </UFormField>

        <UFormField :label="t('admin.stepUp.codeLabel')" :hint="t('admin.stepUp.codeHint')">
          <UInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="w-full"
            :placeholder="t('admin.stepUp.codePlaceholder')"
          />
        </UFormField>

        <p v-if="props.error" class="text-sm text-oxide-600 dark:text-oxide-300" role="alert">
          {{ props.error }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <UButton type="submit" color="primary" :loading="props.confirming">
            {{ t('admin.stepUp.confirm') }}
          </UButton>
          <UButton type="button" variant="ghost" color="neutral" @click="cancel">
            {{ t('admin.stepUp.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
