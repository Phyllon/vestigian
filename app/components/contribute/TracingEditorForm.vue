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

  const toast = useToast()
  const { editsGoLiveImmediately } = useSession()

  const geometry = ref<GeoJSON.Geometry | null>(props.initialGeometry ?? null)
  const editSummary = ref('')
  const isSaving = ref(false)

  const schema = z.object({
    title: z.string().trim().min(3, 'Name the road or structure.').max(240),
    category: z.enum(['infrastructure', 'fortification', 'other']),
    description: z.string().trim().max(20000).optional(),
  })

  type TracingFormState = z.output<typeof schema>

  const state = reactive<Partial<TracingFormState>>({
    title: props.initial?.title ?? '',
    category: props.initial?.category ?? 'infrastructure',
    description: props.initial?.description ?? '',
  })

  const categoryOptions = [
    { label: 'Road, aqueduct or bridge', value: 'infrastructure' },
    { label: 'Wall or defensive line', value: 'fortification' },
    { label: 'Something else', value: 'other' },
  ]

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
      toast.add({ title: 'Draw the line first, then save.', color: 'warning' })
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
        title: 'That could not be saved',
        description:
          (error as { data?: { message?: string } }).data?.message ?? 'Try again shortly.',
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
      <h2 class="text-xl">{{ isEditing ? 'Edit this tracing' : 'Trace a route' }}</h2>
      <p class="text-sm text-ink-500 dark:text-paper-400">
        {{
          isEditing
            ? 'Adjust the existing points, or redraw the course entirely.'
            : 'Click along the course, then adjust the points. Traced routes appear dashed on the map, because a tracing is an interpretation rather than a survey.'
        }}
      </p>
    </header>

    <ContributeGeometryDrawTool :initial-geometry="initialGeometry" @finished="captureGeometry" />

    <p v-if="vertexCount > 0" class="datum">{{ vertexCount }} points captured</p>

    <UForm :schema="schema" :state="state" class="space-y-4" @submit="save">
      <UFormField label="Name" name="title" required>
        <UInput
          v-model="state.title"
          placeholder="Via Claudia Augusta, northern section"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Type" name="category" required>
        <USelect v-model="state.category" :items="categoryOptions" class="w-full" />
      </UFormField>

      <UFormField label="Notes" name="description" hint="Evidence, dating, uncertainty">
        <UTextarea v-model="state.description" :rows="5" class="w-full" />
      </UFormField>

      <UFormField v-if="isEditing" label="What did you change?" hint="Shown in the history">
        <UInput
          v-model="editSummary"
          placeholder="Corrected the course east of the river"
          class="w-full"
        />
      </UFormField>

      <p
        class="rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-500 dark:bg-night-700 dark:text-paper-400"
      >
        {{
          editsGoLiveImmediately
            ? 'Your edits publish immediately.'
            : 'A moderator reviews this before it appears on the map.'
        }}
      </p>

      <div class="flex items-center gap-2">
        <UButton type="submit" :loading="isSaving" :disabled="vertexCount < 2" color="primary">
          {{ isEditing ? 'Save changes' : 'Save tracing' }}
        </UButton>
        <UButton variant="ghost" color="neutral" @click="emit('cancel')">Cancel</UButton>
      </div>
    </UForm>
  </div>
</template>
