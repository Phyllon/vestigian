<script setup lang="ts">
  import type { Map as MapLibreMap } from 'maplibre-gl'
  import type { CameraState } from '#shared/types'

  const container = useTemplateRef<HTMLDivElement>('container')
  const map = shallowRef<MapLibreMap | null>(null)
  const isReady = ref(false)

  const { currentStyle } = useBasemapStyle()
  const { camera: _, restoreCamera, rememberCamera } = useCameraState()
  const { attachOverlay, keepOverlayThroughStyleChanges, findFeatureAtPoint } = useViewportTiles()
  const { selectSite, selectTracing, clearSelection, selectedSiteId } = useSiteQuery()

  provideMapInstance(map)

  const readCamera = (instance: MapLibreMap): CameraState => ({
    center: { lon: instance.getCenter().lng, lat: instance.getCenter().lat },
    zoom: instance.getZoom(),
    bearing: instance.getBearing(),
    pitch: instance.getPitch(),
  })

  const handleFeatureTap = (instance: MapLibreMap, point: { x: number; y: number }): void => {
    const feature = findFeatureAtPoint(instance, point)

    if (!feature) {
      clearSelection()
      return
    }

    // A cluster is an invitation to zoom, not a thing with a detail page.
    if (feature.layer.id === CLUSTER_LAYER_ID) {
      instance.easeTo({
        center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
        zoom: Math.min(instance.getZoom() + 2.5, 18),
        duration: 500,
      })
      return
    }

    const id = feature.properties?.id
    if (typeof id !== 'number') return

    // Sites and tracings have independent id sequences, so which layer the tap
    // landed on is the only thing that says what the id refers to.
    if (feature.layer.id === TRACING_LAYER_ID) {
      selectTracing(id)
      return
    }

    selectSite(id)
  }

  const highlightSelection = (instance: MapLibreMap, id: number | null): void => {
    if (!instance.getSource(OVERLAY_SOURCE_ID)) return
    instance.removeFeatureState({ source: OVERLAY_SOURCE_ID, sourceLayer: 'sites' })
    if (id !== null) {
      instance.setFeatureState(
        { source: OVERLAY_SOURCE_ID, sourceLayer: 'sites', id },
        { selected: true },
      )
    }
  }

  watch(currentStyle, (style) => {
    // setStyle keeps the camera; the overlay is restored by the styledata hook.
    map.value?.setStyle(style)
  })

  watch(selectedSiteId, (id) => {
    if (map.value) highlightSelection(map.value, id)
  })

  onMounted(() => {
    if (!container.value) return

    const instance = createMapInstance({
      container: container.value,
      style: currentStyle.value,
      camera: restoreCamera(),
    })

    instance.on('load', () => {
      attachOverlay(instance)
      keepOverlayThroughStyleChanges(instance)
      isReady.value = true
    })

    instance.on('moveend', () => rememberCamera(readCamera(instance)))
    instance.on('click', (event) => handleFeatureTap(instance, event.point))

    instance.on('mousemove', (event) => {
      const feature = findFeatureAtPoint(instance, event.point)
      instance.getCanvas().style.cursor = feature ? 'pointer' : ''
    })

    map.value = instance
  })

  onBeforeUnmount(() => {
    map.value?.remove()
    map.value = null
  })
</script>

<template>
  <div class="relative h-full w-full">
    <div
      ref="container"
      class="h-full w-full bg-paper-100 dark:bg-night-900"
      role="application"
      aria-label="Map of archaeological sites"
    />

    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      leave-active-class="transition-opacity duration-500 ease-out"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="!isReady"
        class="pointer-events-none absolute inset-0 grid place-items-center bg-paper-100 dark:bg-night-900"
      >
        <p class="eyebrow animate-pulse">Unfolding the map</p>
      </div>
    </Transition>

    <slot />
  </div>
</template>
