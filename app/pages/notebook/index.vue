<script setup lang="ts">
  /**
   * The notebook's front page: standing, marks, and what is still in the queue.
   *
   * The pending count is the reason this page exists. A contribution on
   * probation goes into moderation and then vanishes from the interface
   * entirely — the map does not change, no page lists it, and the only signal
   * is an email whenever a moderator gets to it. Silence reads as breakage.
   */
  import { TRUST_THRESHOLD } from '#shared/utils/authorization'

  const { t, locale } = useI18n()

  const { data, pending, error } = await useFetch('/api/me')

  /**
   * From the shared constant, never a literal. The threshold has one home in
   * `shared/utils/authorization.ts` precisely because it used to appear as a
   * bare `2` in five places, twice transcribed into SQL.
   */
  const contributionsUntilTrusted = computed(() =>
    data.value ? Math.max(TRUST_THRESHOLD - data.value.account.approvedContributions, 0) : 0,
  )

  const trustReason = computed(() => {
    if (!data.value) return ''
    return t(`notebook.trust.${data.value.trust.reason}`)
  })

  useHead({ title: t('notebook.title') })
  useNoIndex()

  definePageMeta({ layout: 'reading', middleware: 'authenticated' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('notebook.title') }}
    </h1>
    <p class="mt-3 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('notebook.intro') }}
    </p>

    <p v-if="pending" class="mt-8 text-sm text-ink-500 dark:text-paper-400">
      {{ t('notebook.loading') }}
    </p>
    <p v-else-if="error || !data" class="mt-8 text-sm text-oxide-700 dark:text-oxide-400">
      {{ t('notebook.loadFailed') }}
    </p>

    <template v-else>
      <section class="leaf mt-8 p-5">
        <h2 class="eyebrow">{{ t('notebook.standingHeading') }}</h2>
        <p class="mt-2 text-base text-ink-900 dark:text-paper-100">{{ trustReason }}</p>
        <p v-if="!data.trust.autoApprove" class="mt-1 text-sm text-ink-600 dark:text-paper-300">
          {{ t('notebook.untilTrusted', contributionsUntilTrusted) }}
        </p>
        <p class="mt-3 text-xs text-ink-500 dark:text-paper-400">
          {{ t('notebook.joined', { date: formatDate(data.account.createdAt, locale) }) }}
        </p>
      </section>

      <!--
        A definition list, not a grid of cards: these are labelled values, and
        `dl`/`dt`/`dd` says so to a screen reader without any ARIA.
      -->
      <section class="mt-6">
        <h2 class="eyebrow">{{ t('notebook.ledgerHeading') }}</h2>
        <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div
            v-for="entry in [
              { label: t('notebook.countSites'), value: data.contributions.sites },
              { label: t('notebook.countTracings'), value: data.contributions.tracings },
              { label: t('notebook.countImages'), value: data.contributions.images },
              { label: t('notebook.countVisits'), value: data.notebook.visitCount },
              { label: t('notebook.countCountries'), value: data.notebook.countriesVisited },
              { label: t('notebook.countBookmarks'), value: data.notebook.bookmarkCount },
            ]"
            :key="entry.label"
            class="leaf p-4"
          >
            <dt class="eyebrow">{{ entry.label }}</dt>
            <dd class="datum mt-1 text-2xl text-ink-900 dark:text-paper-100">{{ entry.value }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-if="data.contributions.pending > 0"
        class="mt-6 rounded-notebook border border-bronze-400 p-4 dark:border-bronze-600"
      >
        <h2 class="font-display text-lg text-ink-900 dark:text-paper-100">
          {{ t('notebook.pendingHeading', data.contributions.pending) }}
        </h2>
        <p class="mt-1 text-sm text-ink-700 dark:text-paper-200">{{ t('notebook.pendingBody') }}</p>
        <UButton
          to="/notebook/contributions"
          color="neutral"
          variant="outline"
          size="sm"
          class="mt-3"
          icon="i-lucide-pen-line"
        >
          {{ t('notebook.pendingAction') }}
        </UButton>
      </section>

      <section v-if="data.notebook.milestones.length > 0" class="mt-6">
        <h2 class="eyebrow">{{ t('milestones.title') }}</h2>
        <NotebookMilestoneStamps :milestones="data.notebook.milestones" class="mt-3" />
      </section>

      <nav class="mt-8 flex flex-wrap gap-3 border-t border-paper-200 pt-5 dark:border-night-700">
        <UButton to="/notebook/visits" color="neutral" variant="outline" icon="i-lucide-footprints">
          {{ t('account.visits') }}
        </UButton>
        <UButton
          to="/notebook/contributions"
          color="neutral"
          variant="outline"
          icon="i-lucide-pen-line"
        >
          {{ t('account.contributions') }}
        </UButton>
        <UButton to="/settings" color="neutral" variant="ghost" icon="i-lucide-settings">
          {{ t('account.settings') }}
        </UButton>
      </nav>
    </template>
  </article>
</template>
