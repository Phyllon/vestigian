<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  interface TracingEditorProps {
    /** Present when editing an existing tracing rather than drawing a new one. */
    tracingId?: number
    initial?: Partial<TracingFormState>
    initialGeometry?: GeoJSON.Geometry
  }

  const props = defineProps<TracingEditorProps>()
  const emit = defineEmits<{ submitted: []; cancel: [] }>()

  const isEditing = computed(() => props.tracingId !== undefined)

  const { t } = useI18n()
  const toast = useToast()
  const { editsGoLiveImmediately } = useSession()

  const geometry = ref<GeoJSON.Geometry | null>(props.initialGeometry ?? null)
  const editSummary = ref('')
  const isSaving = ref(false)

  const schema = z.object({
    title: z.string().trim().min(3, t('tracingEditorForm.nameRequired')).max(240),
    category: z.enum(['infrastructure', 'fortification', 'other']),
    description: z.string().trim().max(20000).optional(),
  })

  type TracingFormState = z.output<typeof schema>

  const state = reactive<Partial<TracingFormState>>({
    title: props.initial?.title ?? '',
    category: props.initial?.category ?? 'infrastructure',
    description: props.initial?.description ?? '',
  })

  const categoryOptions = computed(() => [
    { label: t('tracingEditorForm.categoryOptions.infrastructure'), value: 'infrastructure' },
    { label: t('tracingEditorForm.categoryOptions.fortification'), value: 'fortification' },
    { label: t('tracingEditorForm.categoryOptions.other'), value: 'other' },
  ])

  const vertexCount = computed(() => {
    const drawn = geometry.value
    if (!drawn) return 0
    if (drawn.type === 'LineString') return drawn.coordinates.length
    if (drawn.type === 'Polygon') return drawn.coordinates[0]?.length ?? 0
    return 0
  })

  const captureGeometry = (drawn: GeoJSON.Geometry): void => {
    geometry.value = drawn
  }

  const save = async (event: FormSubmitEvent<TracingFormState>): Promise<void> => {
    if (!geometry.value) {
      toast.add({ title: t('tracingEditorForm.drawFirst'), color: 'warning' })
      return
    }

    isSaving.value = true
    try {
      const result = await $fetch<{ message: string }>('/api/contributions', {
        method: 'POST',
        body: {
          kind: 'tracing',
          ...event.data,
          geometry: geometry.value,
          entityId: props.tracingId,
          editSummary: isEditing.value ? editSummary.value : undefined,
        },
      })
      toast.add({ title: result.message, color: 'success' })
      emit('submitted')
    } catch (error) {
      toast.add({
        title: t('tracingEditorForm.saveFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('tracingEditorForm.tryAgainShortly'),
        color: 'error',
      })
    } finally {
      isSaving.value = false
    }
  }
</script>

<template>
  <div class="space-y-4">
    <header class="space-y-1">
      <h2 class="text-xl">
        {{ isEditing ? t('tracingEditorForm.editTitle') : t('tracingEditorForm.traceTitle') }}
      </h2>
      <p class="text-sm text-ink-500 dark:text-paper-400">
        {{ isEditing ? t('tracingEditorForm.editHint') : t('tracingEditorForm.traceHint') }}
      </p>
    </header>

    <ContributeGeometryDrawTool :initial-geometry="initialGeometry" @finished="captureGeometry" />

    <p v-if="vertexCount > 0" class="datum">
      {{ t('tracingEditorForm.pointsCaptured', { count: vertexCount }) }}
    </p>

    <UForm method="post" :schema="schema" :state="state" class="space-y-4" @submit="save">
      <UFormField :label="t('tracingEditorForm.name')" name="title" required>
        <UInput
          v-model="state.title"
          :placeholder="t('tracingEditorForm.namePlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('tracingEditorForm.type')" name="category" required>
        <USelect v-model="state.category" :items="categoryOptions" class="w-full" />
      </UFormField>

      <UFormField
        :label="t('tracingEditorForm.notes')"
        name="description"
        :hint="t('tracingEditorForm.notesHint')"
      >
        <UTextarea v-model="state.description" :rows="5" class="w-full" />
      </UFormField>

      <UFormField
        v-if="isEditing"
        :label="t('tracingEditorForm.whatChanged')"
        :hint="t('tracingEditorForm.whatChangedHint')"
      >
        <UInput
          v-model="editSummary"
          :placeholder="t('tracingEditorForm.editSummaryPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <p
        class="rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-500 dark:bg-night-700 dark:text-paper-400"
      >
        {{
          editsGoLiveImmediately
            ? t('tracingEditorForm.editsPublishImmediately')
            : t('tracingEditorForm.reviewedBeforeAppearing')
        }}
      </p>

      <div class="flex items-center gap-2">
        <UButton type="submit" :loading="isSaving" :disabled="vertexCount < 2" color="primary">
          {{ isEditing ? t('tracingEditorForm.saveChanges') : t('tracingEditorForm.saveTracing') }}
        </UButton>
        <UButton variant="ghost" color="neutral" @click="emit('cancel')">{{
          t('tracingEditorForm.cancel')
        }}</UButton>
      </div>
    </UForm>
  </div>
</template>
