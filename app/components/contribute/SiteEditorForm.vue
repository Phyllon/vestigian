<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import type { LonLat } from '#shared/types'

  interface SiteEditorProps {
    position: LonLat
    /** Present when editing an existing site rather than recording a new one. */
    siteId?: number
    initial?: Partial<SiteFormState>
  }

  const props = defineProps<SiteEditorProps>()
  const emit = defineEmits<{
    submitted: [result: { revisionId: number; entityId: number | null }]
    cancel: []
  }>()

  const isEditing = computed(() => props.siteId !== undefined)

  const { editsGoLiveImmediately, contributionsUntilTrusted } = useSession()
  const toast = useToast()

  const schema = z.object({
    title: z.string().trim().min(3, 'Give the site a name of at least three characters.').max(240),
    category: z.enum([
      'settlement',
      'fortification',
      'sanctuary',
      'burial',
      'infrastructure',
      'villa',
      'production',
      'findspot',
      'other',
    ]),
    summary: z.string().trim().max(400).optional(),
    description: z.string().trim().max(20000).optional(),
    periodFrom: z.number().int().min(-1200).max(1500).nullable(),
    periodTo: z.number().int().min(-1200).max(1500).nullable(),
  })

  type SiteFormState = z.output<typeof schema>

  const state = reactive<Partial<SiteFormState>>({
    title: props.initial?.title ?? '',
    category: props.initial?.category ?? 'settlement',
    summary: props.initial?.summary ?? '',
    description: props.initial?.description ?? '',
    periodFrom: props.initial?.periodFrom ?? null,
    periodTo: props.initial?.periodTo ?? null,
  })

  /** Required on edits so history reads as a record of decisions, not diffs. */
  const editSummary = ref('')

  const categoryOptions = [
    { label: 'Settlement', value: 'settlement' },
    { label: 'Fortification', value: 'fortification' },
    { label: 'Sanctuary', value: 'sanctuary' },
    { label: 'Burial', value: 'burial' },
    { label: 'Infrastructure', value: 'infrastructure' },
    { label: 'Villa', value: 'villa' },
    { label: 'Production', value: 'production' },
    { label: 'Findspot', value: 'findspot' },
    { label: 'Other', value: 'other' },
  ]

  const isSaving = ref(false)

  const reviewNotice = computed(() =>
    editsGoLiveImmediately.value
      ? 'Your edits publish immediately.'
      : `A moderator reviews this before it appears. ${contributionsUntilTrusted.value} more accepted ${contributionsUntilTrusted.value === 1 ? 'contribution' : 'contributions'} and your edits go live straight away.`,
  )

  const save = async (event: FormSubmitEvent<SiteFormState>): Promise<void> => {
    isSaving.value = true
    try {
      const result = await $fetch<{ revisionId: number; entityId: number | null; message: string }>(
        '/api/contributions',
        {
          method: 'POST',
          body: {
            kind: 'site',
            ...event.data,
            position: props.position,
            entityId: props.siteId,
            editSummary: isEditing.value ? editSummary.value : undefined,
          },
        },
      )
      toast.add({ title: result.message, color: 'success' })
      emit('submitted', { revisionId: result.revisionId, entityId: result.entityId })
    } catch (error) {
      toast.add({
        title: 'That could not be saved',
        description:
          (error as { data?: { message?: string } }).data?.message ?? 'Try again in a moment.',
        color: 'error',
      })
    } finally {
      isSaving.value = false
    }
  }
</script>

<template>
  <UForm :schema="schema" :state="state" class="space-y-4" @submit="save">
    <header class="space-y-1">
      <h2 class="text-xl">{{ isEditing ? 'Edit this site' : 'Record a site' }}</h2>
      <p class="datum">{{ position.lat.toFixed(5) }}, {{ position.lon.toFixed(5) }}</p>
    </header>

    <UFormField label="Name" name="title" required>
      <UInput v-model="state.title" placeholder="Kastell Saalburg" class="w-full" />
    </UFormField>

    <UFormField label="Type" name="category" required>
      <USelect v-model="state.category" :items="categoryOptions" class="w-full" />
    </UFormField>

    <UFormField label="One-line summary" name="summary" hint="Shown in search results">
      <UInput v-model="state.summary" class="w-full" />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="From" name="periodFrom" hint="Negative for BC">
        <UInput v-model.number="state.periodFrom" type="number" class="w-full" />
      </UFormField>
      <UFormField label="To" name="periodTo">
        <UInput v-model.number="state.periodTo" type="number" class="w-full" />
      </UFormField>
    </div>

    <UFormField label="Description" name="description">
      <UTextarea v-model="state.description" :rows="7" class="w-full" />
    </UFormField>

    <UFormField v-if="isEditing" label="What did you change?" hint="Shown in the site's history">
      <UInput v-model="editSummary" placeholder="Corrected the dating" class="w-full" />
    </UFormField>

    <p
      class="rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-500 dark:bg-night-700 dark:text-paper-400"
    >
      {{ reviewNotice }}
    </p>

    <div class="flex items-center gap-2">
      <UButton type="submit" :loading="isSaving" color="primary">
        {{ isEditing ? 'Save changes' : 'Save site' }}
      </UButton>
      <UButton variant="ghost" color="neutral" @click="emit('cancel')">Cancel</UButton>
    </div>
  </UForm>
</template>
