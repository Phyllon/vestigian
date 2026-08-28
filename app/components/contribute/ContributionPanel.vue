<script setup lang="ts">
  import type maplibregl from 'maplibre-gl'
  import type { LonLat } from '#shared/types'

  type ContributionMode = 'choose' | 'site' | 'tracing'

  const emit = defineEmits<{ close: [] }>()

  const map = useMapInstance()

  const mode = ref<ContributionMode>('choose')
  const draftPosition = ref<LonLat | null>(null)
  const createdSiteId = ref<number | null>(null)

  const handleMapClick = (event: maplibregl.MapMouseEvent): void => {
    if (mode.value !== 'site' || draftPosition.value) return
    draftPosition.value = { lon: event.lngLat.lng, lat: event.lngLat.lat }
  }

  const setCrosshair = (active: boolean): void => {
    const canvas = map.value?.getCanvas()
    if (canvas) canvas.style.cursor = active ? 'crosshair' : ''
  }

  const startSite = (): void => {
    mode.value = 'site'
    setCrosshair(true)
  }

  const startTracing = (): void => {
    mode.value = 'tracing'
  }

  const finish = (): void => {
    setCrosshair(false)
    emit('close')
  }

  /** Once a site exists as a row, photographs can be attached to it right away. */
  const onSiteSaved = (payload: { entityId: number | null }): void => {
    createdSiteId.value = payload.entityId
    if (payload.entityId === null) finish()
  }

  onMounted(() => {
    map.value?.on('click', handleMapClick)
  })

  onBeforeUnmount(() => {
    map.value?.off('click', handleMapClick)
    setCrosshair(false)
  })
</script>

<template>
  <aside
    class="absolute inset-x-0 bottom-0 z-30 max-h-[82vh] overflow-y-auto rounded-t-lg bg-paper-50 p-5 shadow-lifted md:inset-y-0 md:left-auto md:right-0 md:w-[26rem] md:rounded-none dark:bg-night-800"
    aria-label="Add to the atlas"
  >
    <div v-if="mode === 'choose'" class="space-y-4">
      <header>
        <h2 class="text-xl">Add to the atlas</h2>
        <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">What did you find?</p>
      </header>

      <button
        type="button"
        class="flex w-full items-start gap-3 rounded-notebook border border-paper-300 p-4 text-left transition hover:border-oxide-600 dark:border-night-600"
        @click="startSite"
      >
        <UIcon
          name="i-lucide-map-pin"
          class="mt-0.5 size-5 shrink-0 text-oxide-600 dark:text-oxide-300"
          aria-hidden="true"
        />
        <span>
          <span class="block font-medium text-ink-900 dark:text-paper-100">A place</span>
          <span class="block text-sm text-ink-500 dark:text-paper-400">
            A fort, villa, sanctuary, findspot — anything with one position.
          </span>
        </span>
      </button>

      <button
        type="button"
        class="flex w-full items-start gap-3 rounded-notebook border border-paper-300 p-4 text-left transition hover:border-oxide-600 dark:border-night-600"
        @click="startTracing"
      >
        <UIcon
          name="i-lucide-spline"
          class="mt-0.5 size-5 shrink-0 text-oxide-600 dark:text-oxide-300"
          aria-hidden="true"
        />
        <span>
          <span class="block font-medium text-ink-900 dark:text-paper-100">A route or line</span>
          <span class="block text-sm text-ink-500 dark:text-paper-400">
            A road, aqueduct or wall traced across the landscape.
          </span>
        </span>
      </button>

      <UButton variant="ghost" color="neutral" block @click="finish">Cancel</UButton>
    </div>

    <div v-else-if="mode === 'site' && !draftPosition" class="space-y-3">
      <h2 class="text-xl">Where is it?</h2>
      <p class="text-sm text-ink-700 dark:text-paper-200">
        Tap the map at the position of the site. You can adjust it afterwards.
      </p>
      <UButton variant="ghost" color="neutral" @click="finish">Cancel</UButton>
    </div>

    <div v-else-if="mode === 'site' && draftPosition" class="space-y-6">
      <ContributeSiteEditorForm
        v-if="createdSiteId === null"
        :position="draftPosition"
        @submitted="onSiteSaved"
        @cancel="finish"
      />

      <template v-else>
        <div
          class="rounded-notebook bg-verdigris-50 px-3 py-2 text-sm text-verdigris-700 dark:bg-verdigris-900 dark:text-verdigris-200"
          role="status"
        >
          Site published. Add photographs while you are here, or close this panel.
        </div>
        <ContributeImageUploader :site-id="createdSiteId" />
        <UButton variant="ghost" color="neutral" block @click="finish">Done</UButton>
      </template>
    </div>

    <ContributeTracingEditorForm v-else @submitted="finish" @cancel="finish" />
  </aside>
</template>
