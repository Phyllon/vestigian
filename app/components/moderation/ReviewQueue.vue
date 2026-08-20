<script setup lang="ts">
interface QueueItem {
  id: number
  entity_type: string
  entity_id: number | null
  payload: Record<string, unknown>
  edit_summary: string | null
  changes: { field: string; kind: 'added' | 'removed' | 'changed'; before: string | null; after: string | null }[]
  created_at: string
  author_name: string | null
  author_accepted: number
  substantial: boolean
  blanking: boolean
}

const toast = useToast()

const { data, refresh, status } = await useFetch<{ items: QueueItem[]; nextCursor: number | null }>(
  '/api/moderation/queue',
)

const reviewing = ref<number | null>(null)
const selected = ref<Set<number>>(new Set())
const isBatchRunning = ref(false)

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
      { method: 'POST', body: { revisionIds: [...selected.value], decision } },
    )
    toast.add({
      title: `${result.succeeded} ${decision}.`,
      description: result.skipped > 0 ? `${result.skipped} skipped.` : undefined,
      color: result.skipped > 0 ? 'warning' : 'success',
    })
    clearSelection()
    await refresh()
  } catch (error) {
    toast.add({
      title: 'Batch review failed',
      description: (error as { data?: { message?: string } }).data?.message ?? 'Try again.',
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
      body: { revisionId, decision },
    })
    toast.add({
      title: decision === 'approved' ? 'Published' : 'Rejected',
      color: decision === 'approved' ? 'success' : 'neutral',
    })
    await refresh()
  } catch (error) {
    toast.add({
      title: 'Review failed',
      description: (error as { data?: { message?: string } }).data?.message ?? 'Try again.',
      color: 'error',
    })
  } finally {
    reviewing.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="status === 'pending'" class="datum">Loading the queue…</div>

    <div
      v-else-if="selected.size > 0"
      class="leaf sticky top-2 z-10 flex flex-wrap items-center gap-2 px-4 py-2"
    >
      <p class="text-sm text-ink-700 dark:text-paper-200">{{ selected.size }} selected</p>
      <div class="ml-auto flex gap-2">
        <UButton size="xs" color="success" :loading="isBatchRunning" @click="reviewBatch('approved')">
          Publish all
        </UButton>
        <UButton size="xs" variant="ghost" color="error" :loading="isBatchRunning" @click="reviewBatch('rejected')">
          Reject all
        </UButton>
        <UButton size="xs" variant="ghost" color="neutral" @click="clearSelection">Clear</UButton>
      </div>
    </div>

    <div v-if="status !== 'pending' && (data?.items.length ?? 0) > 1 && selected.size === 0">
      <UButton size="xs" variant="ghost" color="neutral" @click="selectAll">Select all</UButton>
    </div>

    <div v-else-if="!data?.items.length" class="leaf leaf-margin py-8 pr-6">
      <p class="text-lg">Nothing waiting.</p>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        New contributions from untrusted accounts will appear here.
      </p>
    </div>

    <article
      v-for="item in data?.items ?? []"
      :key="item.id"
      class="leaf leaf-margin py-4 pr-5"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <UCheckbox
          :model-value="selected.has(item.id)"
          :aria-label="`Select revision ${item.id}`"
          @update:model-value="toggleSelection(item.id)"
        />
        <p class="eyebrow">
          {{ item.entity_id ? 'edit to a' : 'new' }} {{ item.entity_type }} · revision {{ item.id }}
        </p>
        <p class="datum">
          {{ item.author_name ?? 'Deleted account' }} · {{ item.author_accepted }} accepted
        </p>
      </div>

      <h2 class="mt-1 text-lg">{{ item.payload.title }}</h2>

      <p
        v-if="item.blanking"
        class="mt-2 rounded-notebook bg-oxide-50 px-3 py-2 text-xs text-oxide-700 dark:bg-oxide-950 dark:text-oxide-300"
      >
        This edit removes more than it adds. Check it against the live record before publishing.
      </p>
      <p
        v-else-if="item.substantial"
        class="mt-2 text-xs text-ink-500 dark:text-paper-400"
      >
        A substantial rewrite.
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

      <div class="mt-4 flex gap-2">
        <UButton
          size="sm"
          color="success"
          :loading="reviewing === item.id"
          @click="decide(item.id, 'approved')"
        >
          Publish
        </UButton>
        <UButton
          size="sm"
          variant="ghost"
          color="error"
          :loading="reviewing === item.id"
          @click="decide(item.id, 'rejected')"
        >
          Reject
        </UButton>
      </div>
    </article>
  </div>
</template>
