<script setup lang="ts">
  const { t } = useI18n()

  definePageMeta({ layout: 'reading' })
  useHead({ title: t('verifyPage.title') })
  useNoIndex()

  const route = useRoute()
  const state = ref<'working' | 'done' | 'failed'>('working')
  const message = ref('')

  /**
   * The card is rewritten in place once the token comes back — same heading
   * slot, different outcome — so `aria-live` on the card is what turns a
   * redraw into something a screen reader reports.
   */
  const verify = async (): Promise<void> => {
    const token = route.query.token as string | undefined
    if (!token) {
      state.value = 'failed'
      message.value = t('verifyPage.missingToken')
      return
    }

    try {
      await $fetch('/api/auth/verify', { method: 'POST', body: { token } })
      state.value = 'done'
    } catch (error) {
      state.value = 'failed'
      message.value =
        (error as { data?: { message?: string } }).data?.message ?? t('verifyPage.couldNotUse')
    }
  }

  onMounted(() => {
    void verify()
  })
</script>

<template>
  <div class="leaf mx-auto max-w-md p-8" aria-live="polite">
    <template v-if="state === 'working'">
      <p class="eyebrow">{{ t('verifyPage.checking') }}</p>
      <h1 class="mt-2 text-2xl">{{ t('verifyPage.oneMoment') }}</h1>
    </template>

    <template v-else-if="state === 'done'">
      <p class="eyebrow">{{ t('verifyPage.confirmed') }}</p>
      <h1 class="mt-2 text-2xl">{{ t('verifyPage.accountReady') }}</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
        {{ t('verifyPage.readyBody') }}
      </p>
      <UButton to="/login" class="mt-5" color="primary">{{ t('verifyPage.signIn') }}</UButton>
    </template>

    <template v-else>
      <p class="eyebrow">{{ t('verifyPage.notConfirmed') }}</p>
      <h1 class="mt-2 text-2xl">{{ t('verifyPage.linkDidNotWork') }}</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">{{ message }}</p>
      <UButton to="/register" class="mt-5" variant="ghost" color="neutral">{{
        t('verifyPage.startAgain')
      }}</UButton>
    </template>
  </div>
</template>
