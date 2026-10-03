<script setup lang="ts">
  /**
   * Content matches what the code actually does — see CLAUDE.md's "GDPR /
   * legal" section for the research this page and the account actions below
   * are built from. The supervisory-authority block is real (BayLDA, the
   * Bavarian data protection authority) — see `.claude/rules/gdpr-legal.md`
   * for why it differs from `impressum.vue`'s own supervisory-authority
   * section, which names a different body entirely.
   */
  const { t } = useI18n()
  const { loggedIn } = useSession()
  const toast = useToast()

  const isExporting = ref(false)
  const isDeleting = ref(false)
  const confirmingDelete = ref(false)

  const exportData = async (): Promise<void> => {
    isExporting.value = true
    try {
      const data = await $fetch('/api/auth/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'vestigian-account-data.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.add({ title: t('privacy.exportFailed'), color: 'error' })
    } finally {
      isExporting.value = false
    }
  }

  const deleteAccount = async (): Promise<void> => {
    isDeleting.value = true
    try {
      await $fetch('/api/auth/account', { method: 'DELETE' })
      await navigateTo('/')
    } catch {
      toast.add({ title: t('privacy.deleteFailed'), color: 'error' })
      isDeleting.value = false
    }
  }

  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('privacy.title') })
  useSeoMeta({ description: t('privacy.intro') })
  useCanonicalUrl()

  useSocialMeta({
    title: t('privacy.title'),
    description: t('privacy.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">{{ t('privacy.title') }}</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('privacy.intro') }}
    </p>

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.controllerHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.controllerBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.accountHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.accountBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.contributionHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.contributionBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.photographHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.photographBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.cookiesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.cookiesBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.performanceHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.performanceBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.logsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.logsBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.recipientsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.recipientsIntro') }}
      </p>
      <ul class="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        <li>{{ t('privacy.recipientHosting') }}</li>
        <li>{{ t('privacy.recipientCdn') }}</li>
        <li>{{ t('privacy.recipientMail') }}</li>
        <li>{{ t('privacy.recipientTranslate') }}</li>
        <li>{{ t('privacy.recipientEnrichment') }}</li>
        <li>{{ t('privacy.recipientColumnReliefs') }}</li>
        <li>{{ t('privacy.recipientBasemap') }}</li>
        <li>{{ t('privacy.recipientSecurity') }}</li>
        <li>{{ t('privacy.recipientBackup') }}</li>
      </ul>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.rightsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.rightsBody') }}
      </p>

      <div v-if="loggedIn" class="mt-4 flex flex-wrap items-center gap-3">
        <UButton
          color="neutral"
          variant="outline"
          :loading="isExporting"
          icon="i-lucide-download"
          @click="exportData"
        >
          {{ t('privacy.exportAction') }}
        </UButton>

        <UButton
          v-if="!confirmingDelete"
          color="error"
          variant="outline"
          icon="i-lucide-trash-2"
          @click="confirmingDelete = true"
        >
          {{ t('privacy.deleteAction') }}
        </UButton>
        <template v-else>
          <span class="text-sm text-ink-700 dark:text-paper-200">{{
            t('privacy.deleteConfirm')
          }}</span>
          <UButton color="error" :loading="isDeleting" @click="deleteAccount">
            {{ t('privacy.deleteConfirmAction') }}
          </UButton>
          <UButton color="neutral" variant="ghost" @click="confirmingDelete = false">
            {{ t('privacy.deleteCancel') }}
          </UButton>
        </template>
      </div>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.supervisoryHeading') }}
      </h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.supervisoryPlaceholder') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.minorsHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.minorsBody') }}
      </p>
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('privacy.changesHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('privacy.changesBody') }}
      </p>
    </section>
  </article>
</template>
