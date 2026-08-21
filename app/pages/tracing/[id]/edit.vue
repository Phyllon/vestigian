<script setup lang="ts">
  import type { TracingDetail } from '~/composables/data/useSiteQuery'

  definePageMeta({ middleware: 'authenticated' })

  const route = useRoute()

  const { data: tracing } = await useFetch<TracingDetail>(() => `/api/tracings/${route.params.id}`)

  if (!tracing.value) {
    throw createError({ statusCode: 404, statusMessage: 'No tracing with that identifier.' })
  }

  useHead({ title: () => `Editing ${tracing.value?.title ?? ''}` })

  const initial = computed(() => ({
    title: tracing.value?.title,
    category: tracing.value?.category as 'infrastructure' | 'fortification' | 'other',
    description: tracing.value?.description ?? '',
  }))

  /** Centre the map on the shape being edited, not on the default view. */
  const startingCamera = computed(() => {
    const geometry = tracing.value?.geometry
    if (!geometry) return null

    const coordinates =
      geometry.type === 'Polygon'
        ? (geometry.coordinates[0] as [number, number][])
        : (geometry?.coordinates as [number, number][])

    const lons = coordinates.map((point) => point[0])
    const lats = coordinates.map((point) => point[1])

    return {
      lon: (Math.min(...lons) + Math.max(...lons)) / 2,
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    }
  })

  const finish = async (): Promise<void> => {
    await navigateTo('/')
  }
</script>

<!-- Editing a shape needs the map, so this page takes over the viewport
     rather than sitting in the reading layout. -->
<template>
  <MapCanvas v-if="tracing">
    <div class="pointer-events-none absolute inset-0">
      <aside
        class="pointer-events-auto absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-lg bg-paper-50 p-5 shadow-lifted md:inset-y-0 md:left-auto md:right-0 md:w-[26rem] md:rounded-none dark:bg-night-800"
      >
        <ContributeTracingEditorForm
          :tracing-id="tracing.id"
          :initial="initial"
          :initial-geometry="tracing.geometry"
          @submitted="finish"
          @cancel="finish"
        />
      </aside>

      <p v-if="startingCamera" class="datum pointer-events-none absolute left-3 top-3">
        {{ startingCamera.lat.toFixed(4) }}, {{ startingCamera.lon.toFixed(4) }}
      </p>
    </div>
  </MapCanvas>
</template>
