<script setup lang="ts">
  import type { Map as MapLibreMap } from 'maplibre-gl'
  import type { CameraState } from '#shared/types'

  const container = useTemplateRef<HTMLDivElement>('container')
  const map = shallowRef<MapLibreMap | null>(null)
  const isReady = ref(false)

  const { currentStyle, view, isDark } = useBasemapStyle()

  /**
   * An antiquity sheet is parchment in both themes — filtering the raster would
   * misrepresent someone else's cartography — so at night the surround does the
   * work instead: the sheet is left as printed and read as paper under a lamp.
   */
  const isLampLit = computed(() => isDark.value && isAntiquityView(view.value))
  const { camera: _, restoreCamera, rememberCamera } = useCameraState()
  const { attachOverlay, keepOverlayThroughStyleChanges, findFeaturesAtPoint } = useViewportTiles()
  const { chooseCandidate, offerOverlappingFeatures, clearSelection, selectedSiteId } =
    useSiteQuery()

  provideMapInstance(map)

  const readCamera = (instance: MapLibreMap): CameraState => ({
    center: { lon: instance.getCenter().lng, lat: instance.getCenter().lat },
    zoom: instance.getZoom(),
    bearing: instance.getBearing(),
    pitch: instance.getPitch(),
  })

  const handleFeatureTap = (instance: MapLibreMap, point: { x: number; y: number }): void => {
    const features = findFeaturesAtPoint(instance, point)

    if (features.length === 0) {
      clearSelection()
      return
    }

    // A cluster is an invitation to zoom, not a thing with a detail page. It is
    // checked first because clusters and sites are never drawn at the same
    // zoom, so a cluster in the results means the tap was below zoom 9.
    const cluster = features.find((feature) => feature.layer.id === CLUSTER_LAYER_ID)
    if (cluster) {
      instance.easeTo({
        center: (cluster.geometry as GeoJSON.Point).coordinates as [number, number],
        zoom: Math.min(instance.getZoom() + 2.5, 18),
        duration: 500,
      })
      return
    }

    const candidates = describeFeatures({ map: instance, features, point })

    if (candidates.length === 0) {
      clearSelection()
      return
    }

    // One record under the finger goes straight through; several are offered,
    // because picking for the reader means picking wrong most of the time.
    if (candidates.length === 1) {
      clearSelection()
      chooseCandidate(candidates[0]!)
      return
    }

    offerOverlappingFeatures(candidates)
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
      const hits = findFeaturesAtPoint(instance, event.point)
      instance.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : ''
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

    <div
      v-if="isLampLit"
      class="pointer-events-none absolute inset-0 shadow-[inset_0_0_9rem_2rem_var(--color-night-900)]"
      aria-hidden="true"
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
        <p class="eyebrow animate-pulse" role="status">Unfolding the map</p>
      </div>
    </Transition>

    <slot />
  </div>
</template>
