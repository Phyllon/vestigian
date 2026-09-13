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

  const { t } = useI18n()
  const { editsGoLiveImmediately, contributionsUntilTrusted } = useSession()
  const toast = useToast()

  const schema = z.object({
    title: z.string().trim().min(3, t('siteEditorForm.nameTooShort')).max(240),
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

  const categoryOptions = computed(() => [
    { label: t('categories.settlement'), value: 'settlement' },
    { label: t('categories.fortification'), value: 'fortification' },
    { label: t('categories.sanctuary'), value: 'sanctuary' },
    { label: t('categories.burial'), value: 'burial' },
    { label: t('categories.infrastructure'), value: 'infrastructure' },
    { label: t('categories.villa'), value: 'villa' },
    { label: t('categories.production'), value: 'production' },
    { label: t('categories.findspot'), value: 'findspot' },
    { label: t('categories.other'), value: 'other' },
  ])

  const isSaving = ref(false)

  const reviewNotice = computed(() =>
    editsGoLiveImmediately.value
      ? t('siteEditorForm.editsPublishImmediately')
      : t('siteEditorForm.reviewNotice', {
          count: contributionsUntilTrusted.value,
          contributionWord: t(
            contributionsUntilTrusted.value === 1
              ? 'siteEditorForm.contribution'
              : 'siteEditorForm.contributions',
          ),
        }),
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
        title: t('siteEditorForm.saveFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('siteEditorForm.tryAgainMoment'),
        color: 'error',
      })
    } finally {
      isSaving.value = false
    }
  }
</script>

<template>
  <UForm method="post" :schema="schema" :state="state" class="space-y-4" @submit="save">
    <header class="space-y-1">
      <h2 class="text-xl">
        {{ isEditing ? t('siteEditorForm.editTitle') : t('siteEditorForm.recordTitle') }}
      </h2>
      <p class="datum">{{ position.lat.toFixed(5) }}, {{ position.lon.toFixed(5) }}</p>
    </header>

    <UFormField :label="t('siteEditorForm.name')" name="title" required>
      <UInput
        v-model="state.title"
        :placeholder="t('siteEditorForm.namePlaceholder')"
        class="w-full"
      />
    </UFormField>

    <UFormField :label="t('siteEditorForm.type')" name="category" required>
      <USelect v-model="state.category" :items="categoryOptions" class="w-full" />
    </UFormField>

    <UFormField
      :label="t('siteEditorForm.summary')"
      name="summary"
      :hint="t('siteEditorForm.summaryHint')"
    >
      <UInput v-model="state.summary" class="w-full" />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField
        :label="t('siteEditorForm.from')"
        name="periodFrom"
        :hint="t('siteEditorForm.fromHint')"
      >
        <UInput v-model.number="state.periodFrom" type="number" class="w-full" />
      </UFormField>
      <UFormField :label="t('siteEditorForm.to')" name="periodTo">
        <UInput v-model.number="state.periodTo" type="number" class="w-full" />
      </UFormField>
    </div>

    <UFormField :label="t('siteEditorForm.description')" name="description">
      <UTextarea v-model="state.description" :rows="7" class="w-full" />
    </UFormField>

    <UFormField
      v-if="isEditing"
      :label="t('siteEditorForm.whatChanged')"
      :hint="t('siteEditorForm.whatChangedHint')"
    >
      <UInput
        v-model="editSummary"
        :placeholder="t('siteEditorForm.editSummaryPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <p
      class="rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-500 dark:bg-night-700 dark:text-paper-400"
    >
      {{ reviewNotice }}
    </p>

    <div class="flex items-center gap-2">
      <UButton type="submit" :loading="isSaving" color="primary">
        {{ isEditing ? t('siteEditorForm.saveChanges') : t('siteEditorForm.saveSite') }}
      </UButton>
      <UButton variant="ghost" color="neutral" @click="emit('cancel')">{{
        t('siteEditorForm.cancel')
      }}</UButton>
    </div>
  </UForm>
</template>
