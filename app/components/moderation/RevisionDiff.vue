<script setup lang="ts">
interface FieldChange {
  field: string
  kind: 'added' | 'removed' | 'changed'
  before: string | null
  after: string | null
}

defineProps<{ changes: FieldChange[] }>()

const FIELD_LABELS: Record<string, string> = {
  title: 'Name',
  category: 'Type',
  summary: 'Summary',
  description: 'Description',
  position: 'Position',
  periodFrom: 'Period from',
  periodTo: 'Period to',
  geometry: 'Shape',
  editSummary: 'Edit note',
}

const labelFor = (field: string): string => FIELD_LABELS[field] ?? field

/** Long values are clipped: a diff is for scanning, not for reading in full. */
const clip = (value: string | null): string => {
  if (value === null) return '—'
  return value.length > 220 ? `${value.slice(0, 220)}…` : value
}
</script>

<template>
  <dl v-if="changes.length > 0" class="space-y-2">
    <div
      v-for="change in changes"
      :key="change.field"
      class="rounded-notebook border border-paper-200 px-3 py-2 dark:border-night-700"
    >
      <dt class="flex items-center gap-2">
        <span class="eyebrow">{{ labelFor(change.field) }}</span>
        <span
          class="rounded-full px-1.5 py-px text-[0.625rem] uppercase tracking-wide"
          :class="{
            'bg-verdigris-100 text-verdigris-700 dark:bg-verdigris-900 dark:text-verdigris-200':
              change.kind === 'added',
            'bg-oxide-100 text-oxide-700 dark:bg-oxide-950 dark:text-oxide-300':
              change.kind === 'removed',
            'bg-paper-200 text-ink-600 dark:bg-night-700 dark:text-paper-300':
              change.kind === 'changed',
          }"
        >
          {{ change.kind }}
        </span>
      </dt>

      <dd class="mt-1 space-y-1 text-sm">
        <p
          v-if="change.before !== null"
          class="text-ink-500 line-through decoration-oxide-400/60 dark:text-paper-400"
        >
          {{ clip(change.before) }}
        </p>
        <p v-if="change.after !== null" class="text-ink-900 dark:text-paper-100">
          {{ clip(change.after) }}
        </p>
      </dd>
    </div>
  </dl>

  <p v-else class="datum">No fields changed.</p>
</template>
