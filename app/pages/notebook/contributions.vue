<script setup lang="ts">
  /**
   * Everything this account has submitted, newest first — and specifically what
   * is still waiting.
   *
   * The moderation queue is ordered oldest-first because it is a fairness
   * ordering over other people's work. This is the same table read the other
   * way round: someone looking at their own record wants the last thing they
   * did, and the pending items at the top are the point.
   */
  const { t, locale } = useI18n()

  /**
   * The first page comes from `useFetch`, so it is rendered on the server and
   * is on screen at first paint. Loading it in `onMounted` instead left the
   * server rendering neither the list nor the empty state — an authenticated
   * page that arrives blank and fills in a moment later.
   *
   * Later pages are appended by hand, because "show more" is a client action
   * and re-running the whole fetch would discard what is already on screen.
   */
  const { data: firstPage, error: firstError } = await useFetch('/api/me/contributions')

  const items = ref<
    {
      id: number
      entityType: string
      entityId: number | null
      status: string
      title: string | null
      slug: string | null
      editSummary: string | null
      reviewNote: string | null
      reviewerName: string | null
      autoApproved: boolean
      isRevert: boolean
      createdAt: string
      reviewedAt: string | null
    }[]
  >(firstPage.value?.items ?? [])
  const nextCursor = ref<number | null>(firstPage.value?.nextCursor ?? null)
  const isLoading = ref(false)
  const hasFailed = ref(Boolean(firstError.value))

  const statusTone: Record<string, string> = {
    pending: 'text-bronze-700 dark:text-bronze-400',
    approved: 'text-verdigris-700 dark:text-verdigris-400',
    rejected: 'text-oxide-700 dark:text-oxide-400',
  }

  const recordLink = (item: (typeof items.value)[number]): string | null => {
    if (item.slug) return `/site/${item.slug}`
    if (item.entityType === 'tracing' && item.entityId) return `/tracing/${item.entityId}`
    return null
  }

  const loadMore = async (): Promise<void> => {
    if (!nextCursor.value) return
    isLoading.value = true
    try {
      const page = await $fetch('/api/me/contributions', {
        query: { cursor: nextCursor.value },
      })
      items.value = [...items.value, ...page.items]
      nextCursor.value = page.nextCursor
    } catch {
      hasFailed.value = true
    } finally {
      isLoading.value = false
    }
  }

  useHead({ title: t('notebook.contributionsTitle') })
  useNoIndex()

  definePageMeta({ layout: 'reading', middleware: 'authenticated' })
</script>

<template>
  <article>
    <NuxtLink
      to="/notebook"
      class="eyebrow inline-flex items-center gap-1 hover:text-ink-900 dark:hover:text-paper-100"
    >
      <UIcon name="i-lucide-arrow-left" class="size-3" />
      {{ t('notebook.title') }}
    </NuxtLink>

    <h1 class="mt-3 font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('notebook.contributionsTitle') }}
    </h1>
    <p class="mt-3 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('notebook.contributionsIntro') }}
    </p>

    <p v-if="hasFailed" class="mt-8 text-sm text-oxide-700 dark:text-oxide-400">
      {{ t('notebook.loadFailed') }}
    </p>
    <p v-else-if="items.length === 0" class="mt-8 text-sm text-ink-600 dark:text-paper-300">
      {{ t('notebook.contributionsEmpty') }}
    </p>

    <ol v-else class="mt-6 space-y-3">
      <li v-for="item in items" :key="item.id" class="leaf p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <component
            :is="recordLink(item) ? 'NuxtLink' : 'span'"
            :to="recordLink(item) ?? undefined"
            class="font-display text-lg text-ink-900 dark:text-paper-100"
            :class="recordLink(item) && 'hover:text-oxide-700 dark:hover:text-oxide-400'"
          >
            {{ item.title ?? t('notebook.untitledRecord') }}
          </component>

          <p class="eyebrow" :class="statusTone[item.status]">
            {{ t(`notebook.status.${item.status}`) }}
          </p>
        </div>

        <p class="mt-1 text-xs text-ink-500 dark:text-paper-400">
          <time :datetime="item.createdAt" class="datum">
            {{ formatDate(item.createdAt, locale) }}
          </time>
          · {{ t(`notebook.entity.${item.entityType}`) }}
          <template v-if="item.isRevert"> · {{ t('notebook.isRevert') }}</template>
          <template v-else-if="item.autoApproved">
            · {{ t('notebook.publishedDirectly') }}</template
          >
        </p>

        <p v-if="item.editSummary" class="mt-2 text-sm text-ink-700 dark:text-paper-200">
          {{ item.editSummary }}
        </p>

        <!--
          What a moderator wrote, shown verbatim and attributed. A rejection
          with nothing in it is a decision the author cannot act on, which is
          why the review form asks for a note — this is where it lands.
        -->
        <blockquote
          v-if="item.reviewNote"
          class="mt-2 border-l-2 border-bronze-400 pl-3 text-sm leading-relaxed text-ink-700 dark:border-bronze-600 dark:text-paper-200"
        >
          <p>{{ item.reviewNote }}</p>
          <footer v-if="item.reviewerName" class="mt-1 text-xs text-ink-500 dark:text-paper-400">
            — {{ item.reviewerName }}
          </footer>
        </blockquote>

        <p v-if="item.status === 'pending'" class="mt-2 text-xs text-ink-500 dark:text-paper-400">
          {{ t('notebook.pendingExplainer') }}
        </p>
      </li>
    </ol>

    <UButton
      v-if="nextCursor"
      class="mt-6"
      color="neutral"
      variant="outline"
      :loading="isLoading"
      @click="loadMore"
    >
      {{ t('notebook.loadMore') }}
    </UButton>
  </article>
</template>
