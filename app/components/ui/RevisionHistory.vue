<script setup lang="ts">
  interface RevisionEntry {
    id: number
    editSummary: string | null
    createdAt: string
    authorName: string | null
    reviewerName: string | null
    autoApproved: boolean
    isRevert: boolean
    changes: {
      field: string
      kind: 'added' | 'removed' | 'changed'
      before: string | null
      after: string | null
    }[]
  }

  interface RevisionHistoryProps {
    entityId: number
    /** Which collection the id belongs to — sites and tracings number separately. */
    entityType: 'site' | 'tracing'
  }

  const props = defineProps<RevisionHistoryProps>()

  const endpoint = computed(() =>
    props.entityType === 'site'
      ? `/api/sites/${props.entityId}/revisions`
      : `/api/tracings/${props.entityId}/revisions`,
  )

  const { isModerator } = useSession()
  const toast = useToast()

  const { data: revisions, refresh, status } = await useFetch<RevisionEntry[]>(() => endpoint.value)

  const expanded = ref<number | null>(null)
  const reverting = ref<number | null>(null)

  const toggle = (id: number): void => {
    expanded.value = expanded.value === id ? null : id
  }

  const formatWhen = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' })

  const revert = async (revisionId: number): Promise<void> => {
    reverting.value = revisionId
    try {
      await $fetch('/api/moderation/revert', { method: 'POST', body: { revisionId } })
      toast.add({ title: 'Reverted. The earlier version is live again.', color: 'success' })
      await refresh()
      await refreshNuxtData()
    } catch (error) {
      toast.add({
        title: 'Could not revert',
        description: (error as { data?: { message?: string } }).data?.message ?? 'Try again.',
        color: 'error',
      })
    } finally {
      reverting.value = null
    }
  }
</script>

<template>
  <section>
    <h2 class="eyebrow">History</h2>

    <p v-if="status === 'pending'" class="datum mt-2">Loading…</p>

    <ol v-else class="mt-3 space-y-1">
      <li
        v-for="revision in revisions ?? []"
        :key="revision.id"
        class="border-b border-paper-200 pb-2 last:border-b-0 dark:border-night-700"
      >
        <button
          type="button"
          class="flex w-full items-baseline gap-2 py-1 text-left"
          :aria-expanded="expanded === revision.id"
          @click="toggle(revision.id)"
        >
          <span class="text-sm text-ink-900 dark:text-paper-100">
            {{ revision.editSummary || (revision.changes.length === 0 ? 'Created' : 'Edited') }}
          </span>
          <span v-if="revision.isRevert" class="eyebrow text-oxide-600 dark:text-oxide-300">
            revert
          </span>
          <span class="datum ml-auto shrink-0">
            {{ revision.authorName ?? 'Unknown' }} · {{ formatWhen(revision.createdAt) }}
          </span>
        </button>

        <div v-if="expanded === revision.id" class="mt-2 space-y-3 pb-2">
          <ModerationRevisionDiff :changes="revision.changes" />

          <p class="datum">
            {{
              revision.autoApproved
                ? 'Published automatically — the author has earned trust.'
                : revision.reviewerName
                  ? `Reviewed by ${revision.reviewerName}.`
                  : 'Published.'
            }}
          </p>

          <UButton
            v-if="isModerator && revision.changes.length > 0"
            size="xs"
            variant="ghost"
            color="error"
            :loading="reverting === revision.id"
            @click="revert(revision.id)"
          >
            Restore the version before this
          </UButton>
        </div>
      </li>
    </ol>
  </section>
</template>
