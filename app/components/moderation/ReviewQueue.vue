<script setup lang="ts">
  interface QueueItem {
    id: number
    entity_type: string
    entity_id: number | null
    payload: Record<string, unknown>
    edit_summary: string | null
    changes: {
      field: string
      kind: 'added' | 'removed' | 'changed'
      before: string | null
      after: string | null
    }[]
    created_at: string
    author_name: string | null
    author_accepted: number
    substantial: boolean
    blanking: boolean
  }

  const toast = useToast()
  const { t } = useI18n()

  const { data, refresh, status } = await useFetch<{
    items: QueueItem[]
    nextCursor: number | null
  }>('/api/moderation/queue')

  const reviewing = ref<number | null>(null)
  const selected = ref<Set<number>>(new Set())
  const isBatchRunning = ref(false)

  /**
   * What the moderator wants to say, kept per revision and once for the batch.
   *
   * Both endpoints have always accepted a note and nothing ever sent one, which
   * did not matter while the decision was only visible in the queue. It matters
   * now that the decision is emailed: without this, every rejection reached its
   * author saying that it was refused and nothing about why.
   */
  const notes = reactive<Record<number, string>>({})
  const batchNote = ref('')

  const toggleSelection = (revisionId: number): void => {
    const next = new Set(selected.value)
    if (next.has(revisionId)) next.delete(revisionId)
    else next.add(revisionId)
    selected.value = next
  }

  const selectAll = (): void => {
    selected.value = new Set((data.value?.items ?? []).map((item) => item.id))
  }

  const clearSelection = (): void => {
    selected.value = new Set()
  }

  const reviewBatch = async (decision: 'approved' | 'rejected'): Promise<void> => {
    isBatchRunning.value = true
    try {
      const result = await $fetch<{ succeeded: number; skipped: number }>(
        '/api/moderation/review-batch',
        {
          method: 'POST',
          body: {
            revisionIds: [...selected.value],
            decision,
            note: batchNote.value.trim() || undefined,
          },
        },
      )
      toast.add({
        title: t('moderation.reviewQueue.batchResultTitle', {
          count: result.succeeded,
          decision:
            decision === 'approved'
              ? t('moderation.reviewQueue.approvedPlural')
              : t('moderation.reviewQueue.rejectedPlural'),
        }),
        description:
          result.skipped > 0
            ? t('moderation.reviewQueue.batchResultSkipped', { count: result.skipped })
            : undefined,
        color: result.skipped > 0 ? 'warning' : 'success',
      })
      batchNote.value = ''
      clearSelection()
      await refresh()
    } catch (error) {
      toast.add({
        title: t('moderation.reviewQueue.batchFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('moderation.reviewQueue.tryAgain'),
        color: 'error',
      })
    } finally {
      isBatchRunning.value = false
    }
  }

  const decide = async (revisionId: number, decision: 'approved' | 'rejected'): Promise<void> => {
    reviewing.value = revisionId
    try {
      await $fetch('/api/moderation/review', {
        method: 'POST',
        body: { revisionId, decision, note: notes[revisionId]?.trim() || undefined },
      })
      notes[revisionId] = ''
      toast.add({
        title:
          decision === 'approved'
            ? t('moderation.reviewQueue.published')
            : t('moderation.reviewQueue.rejected'),
        color: decision === 'approved' ? 'success' : 'neutral',
      })
      await refresh()
    } catch (error) {
      toast.add({
        title: t('moderation.reviewQueue.reviewFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('moderation.reviewQueue.tryAgain'),
        color: 'error',
      })
    } finally {
      reviewing.value = null
    }
  }
</script>

<template>
  <div class="space-y-4">
    <p v-if="status === 'pending'" class="datum" role="status">
      {{ t('moderation.reviewQueue.loading') }}
    </p>

    <fieldset
      v-else-if="selected.size > 0"
      class="leaf sticky top-2 z-10 flex min-w-0 flex-wrap items-center gap-2 px-4 py-2"
      aria-label="Actions for the selected revisions"
    >
      <p class="text-sm text-ink-700 dark:text-paper-200" role="status">
        {{ t('moderation.reviewQueue.selectedCount', { count: selected.size }) }}
      </p>

      <UInput
        v-model="batchNote"
        :placeholder="t('moderation.reviewQueue.batchNotePlaceholder')"
        aria-label="Note sent to the author of every selected revision"
        size="xs"
        class="w-full sm:w-72"
      />
      <div class="ml-auto flex gap-2">
        <UButton
          size="xs"
          color="success"
          :loading="isBatchRunning"
          @click="reviewBatch('approved')"
        >
          {{ t('moderation.reviewQueue.publishAll') }}
        </UButton>
        <UButton
          size="xs"
          variant="ghost"
          color="error"
          :loading="isBatchRunning"
          @click="reviewBatch('rejected')"
        >
          {{ t('moderation.reviewQueue.rejectAll') }}
        </UButton>
        <UButton size="xs" variant="ghost" color="neutral" @click="clearSelection">
          {{ t('moderation.reviewQueue.clear') }}
        </UButton>
      </div>
    </fieldset>

    <div v-if="status !== 'pending' && (data?.items.length ?? 0) > 1 && selected.size === 0">
      <UButton size="xs" variant="ghost" color="neutral" @click="selectAll">
        {{ t('moderation.reviewQueue.selectAll') }}
      </UButton>
    </div>

    <div v-else-if="!data?.items.length" class="leaf px-6 py-8">
      <p class="text-lg">{{ t('moderation.reviewQueue.nothingWaitingTitle') }}</p>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        {{ t('moderation.reviewQueue.nothingWaitingHint') }}
      </p>
    </div>

    <article
      v-for="item in data?.items ?? []"
      :key="item.id"
      :aria-labelledby="`revision-title-${item.id}`"
      class="leaf px-5 py-4"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <UCheckbox
          :model-value="selected.has(item.id)"
          :aria-label="t('moderation.reviewQueue.selectRevision', { id: item.id })"
          @update:model-value="toggleSelection(item.id)"
        />
        <p class="eyebrow">
          {{
            item.entity_id
              ? t('moderation.reviewQueue.editToA')
              : t('moderation.reviewQueue.newEntity')
          }}
          {{ item.entity_type }} ·
          {{ t('moderation.reviewQueue.revision', { id: item.id }) }}
        </p>
        <p class="datum">
          {{ item.author_name ?? t('moderation.reviewQueue.deletedAccount') }} ·
          {{ t('moderation.reviewQueue.acceptedCount', { count: item.author_accepted }) }}
        </p>
      </div>

      <h2 :id="`revision-title-${item.id}`" class="mt-1 text-lg">{{ item.payload.title }}</h2>

      <p
        v-if="item.blanking"
        class="mt-2 rounded-notebook bg-oxide-50 px-3 py-2 text-xs text-oxide-700 dark:bg-oxide-950 dark:text-oxide-300"
      >
        {{ t('moderation.reviewQueue.blankingWarning') }}
      </p>
      <p v-else-if="item.substantial" class="mt-2 text-xs text-ink-500 dark:text-paper-400">
        {{ t('moderation.reviewQueue.substantialNote') }}
      </p>

      <p v-if="item.payload.summary" class="mt-1 text-sm text-ink-700 dark:text-paper-200">
        {{ item.payload.summary }}
      </p>

      <p v-if="item.edit_summary" class="mt-1 text-sm italic text-ink-500 dark:text-paper-400">
        “{{ item.edit_summary }}”
      </p>

      <div class="mt-3">
        <ModerationRevisionDiff :changes="item.changes" />
      </div>

      <UFormField
        :label="
          t('moderation.reviewQueue.noteToAuthor', {
            name: item.author_name ?? t('moderation.reviewQueue.theContributor'),
          })
        "
        :hint="t('moderation.reviewQueue.noteHint')"
        class="mt-4"
      >
        <UTextarea
          v-model="notes[item.id]"
          :rows="2"
          :placeholder="t('moderation.reviewQueue.notePlaceholder')"
          class="w-full"
        />
      </UFormField>

      <div class="mt-3 flex gap-2">
        <!-- One pair per queued revision, so the name says which one. -->
        <UButton
          size="sm"
          color="success"
          :loading="reviewing === item.id"
          :aria-label="t('moderation.reviewQueue.publishAria', { title: item.payload.title })"
          @click="decide(item.id, 'approved')"
        >
          {{ t('moderation.reviewQueue.publish') }}
        </UButton>
        <UButton
          size="sm"
          variant="ghost"
          color="error"
          :loading="reviewing === item.id"
          :aria-label="t('moderation.reviewQueue.rejectAria', { title: item.payload.title })"
          @click="decide(item.id, 'rejected')"
        >
          {{ t('moderation.reviewQueue.reject') }}
        </UButton>
      </div>
    </article>
  </div>
</template>
