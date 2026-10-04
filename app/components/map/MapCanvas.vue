<script setup lang="ts">
  import type { Map as MapLibreMap } from 'maplibre-gl'
  import type { CameraState } from '#shared/types'

  const { t } = useI18n()
  const container = useTemplateRef<HTMLDivElement>('container')
  const map = shallowRef<MapLibreMap | null>(null)
  const isReady = ref(false)

  const {
    currentStyle,
    view,
    isDark,
    periodYear,
    isClusteringSites,
    referenceOverlaysActive,
    isShowingPolities,
  } = useBasemapStyle()

  /**
   * An antiquity sheet is parchment in both themes — filtering the raster would
   * misrepresent someone else's cartography — so at night the surround does the
   * work instead: the sheet is left as printed and read as paper under a lamp.
   */
  const isLampLit = computed(() => isDark.value && isAntiquityView(view.value))
  const { camera: _, restoreCamera, rememberCamera } = useCameraState()
  const {
    isActive: isShowingSites,
    attachOverlay,
    detachOverlay,
    attachOverlayIcons,
    keepOverlayThroughStyleChanges,
    refreshLimesDimming,
    refreshSiteClustering,
    findFeaturesAtPoint,
  } = useViewportTiles()
  const {
    isActive: isFollowingLimes,
    attachLimesOverlay,
    detachLimesOverlay,
    keepLimesOverlayThroughStyleChanges,
  } = useLimesOverlay()
  const {
    attachPeriodOverlay,
    detachPeriodOverlay,
    syncPolities,
    keepPeriodOverlayThroughStyleChanges,
  } = usePeriodOverlay()
  const { syncReferenceOverlays, keepReferenceOverlaysThroughStyleChanges } = useReferenceOverlays()
  const {
    isActive: isShowingBattles,
    attachBattleOverlay,
    detachBattleOverlay,
    keepBattleOverlayThroughStyleChanges,
  } = useBattleOverlay()
  const {
    isActive: isShowingPorts,
    attachPortOverlay,
    detachPortOverlay,
    keepPortOverlayThroughStyleChanges,
  } = usePortOverlay()
  const {
    isActive: isShowingRoutes,
    attachRouteOverlay,
    detachRouteOverlay,
    keepRouteOverlayThroughStyleChanges,
  } = useRouteOverlay()
  const {
    isActive: isShowingFeatures,
    attachFeatureOverlay,
    detachFeatureOverlay,
    keepFeatureOverlayThroughStyleChanges,
  } = useMinorFeatureOverlay()
  const {
    isActive: isShowingCoinHoards,
    attachCoinHoardOverlay,
    detachCoinHoardOverlay,
    keepCoinHoardOverlayThroughStyleChanges,
  } = useCoinHoardOverlay()
  const {
    isActive: isShowingInscriptions,
    attachInscriptionsOverlay,
    detachInscriptionsOverlay,
    keepInscriptionsOverlayThroughStyleChanges,
  } = useInscriptionsOverlay()
  const {
    isActive: isShowingAtticInscriptions,
    attachAtticInscriptionsOverlay,
    detachAtticInscriptionsOverlay,
    keepAtticInscriptionsOverlayThroughStyleChanges,
  } = useAtticInscriptionsOverlay()
  const {
    isActive: isShowingModernLabels,
    attachModernLabelsOverlay,
    detachModernLabelsOverlay,
    keepModernLabelsOverlayThroughStyleChanges,
  } = useModernLabelsOverlay()
  const {
    load: loadNotebook,
    overlay: notebookOverlay,
    attachNotebookOverlay,
    keepNotebookThroughStyleChanges,
    refreshNotebookOverlay,
  } = useNotebookOverlay()
  const { attachAtlasPlaceOverlay } = useAtlasPlaceOverlay()
  const {
    isActive: isShowingTabulaPeutingerianaOverlay,
    load: loadTabulaPeutingerianaOverlay,
    attachTabulaPeutingerianaOverlay,
    detachTabulaPeutingerianaOverlay,
    keepTabulaPeutingerianaOverlayThroughStyleChanges,
  } = useTabulaPeutingerianaOverlay()
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

  // Marking a visit from the site panel redraws its ring immediately. The
  // notebook keeps coordinates on every entry precisely so this needs no fetch.
  watch(notebookOverlay, () => {
    if (map.value) refreshNotebookOverlay(map.value)
  })

  watch(isShowingTabulaPeutingerianaOverlay, async (isActive) => {
    if (!map.value) return
    if (!isActive) {
      detachTabulaPeutingerianaOverlay(map.value)
      return
    }
    await loadTabulaPeutingerianaOverlay()
    attachTabulaPeutingerianaOverlay(map.value)
  })

  /**
   * The frontier switch no longer always changes `currentStyle`'s content —
   * only the Barrington sheet reads `isFollowingLimes` at all — so toggling it
   * over any other basemap cannot rely on the `currentStyle` watcher's
   * `setStyle` call to reach it. Attached and dimmed directly instead; see
   * `refreshLimesDimming`'s own docstring for why the dimming half needs this
   * too.
   */
  watch(isFollowingLimes, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachLimesOverlay(map.value)
    } else {
      detachLimesOverlay(map.value)
    }
    refreshLimesDimming(map.value)
  })

  /**
   * The period overlay's source URL carries the year itself
   * (`/api/tiles/antiquity-empire/:year/...`), so a change in `periodYear`
   * has to rebuild the source and layers even while the overlay stays
   * switched on — not just when it toggles between "off" and a value, the
   * shape every other overlay's watcher follows.
   */
  watch(periodYear, () => {
    if (!map.value) return
    detachPeriodOverlay(map.value)
    attachPeriodOverlay(map.value)
  })

  /** The neighbours have their own switch; the extent they sit under is untouched. */
  watch(isShowingPolities, () => {
    if (map.value) syncPolities(map.value)
  })

  /** One record of switches for Itiner-e, Nomisma, the Wikidata monuments and I.Sicily. */
  watch(
    referenceOverlaysActive,
    () => {
      if (map.value) syncReferenceOverlays(map.value)
    },
    { deep: true },
  )

  watch(isShowingBattles, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachBattleOverlay(map.value)
    } else {
      detachBattleOverlay(map.value)
    }
  })

  watch(isShowingSites, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachOverlay(map.value)
      // A record opened while the layer was off (the featured list does this)
      // had no source to ring when its selection was set.
      highlightSelection(map.value, selectedSiteId.value)
    } else {
      detachOverlay(map.value)
    }
  })

  // Changes the tile URL, not the style, so no `styledata` follows to carry it. The
  // rebuilt source has no feature state, so the open record's ring is put back.
  watch(isClusteringSites, () => {
    if (!map.value) return
    refreshSiteClustering(map.value)
    highlightSelection(map.value, selectedSiteId.value)
  })

  watch(isShowingPorts, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachPortOverlay(map.value)
    } else {
      detachPortOverlay(map.value)
    }
  })

  watch(isShowingRoutes, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachRouteOverlay(map.value)
    } else {
      detachRouteOverlay(map.value)
    }
  })

  watch(isShowingFeatures, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachFeatureOverlay(map.value)
    } else {
      detachFeatureOverlay(map.value)
    }
  })

  watch(isShowingCoinHoards, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachCoinHoardOverlay(map.value)
    } else {
      detachCoinHoardOverlay(map.value)
    }
  })

  watch(isShowingInscriptions, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachInscriptionsOverlay(map.value)
    } else {
      detachInscriptionsOverlay(map.value)
    }
  })

  watch(isShowingAtticInscriptions, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachAtticInscriptionsOverlay(map.value)
    } else {
      detachAtticInscriptionsOverlay(map.value)
    }
  })

  watch(isShowingModernLabels, (isActive) => {
    if (!map.value) return
    if (isActive) {
      attachModernLabelsOverlay(map.value)
    } else {
      detachModernLabelsOverlay(map.value)
    }
  })

  onMounted(() => {
    if (!container.value) return

    const instance = createMapInstance({
      container: container.value,
      style: currentStyle.value,
      camera: restoreCamera(),
    })

    // Browser-side timings for the dashboards (`useWebVitals`): a usable canvas,
    // then the first moment every visible tile is drawn. `performance.now()` is
    // measured from navigation start, which is what a visitor waited.
    instance.once('load', () => queueVital('map-load', performance.now()))
    instance.once('idle', () => queueVital('map-idle', performance.now()))

    instance.on('load', () => {
      // Before every overlay: the frontier and battle marks are drawn from
      // this same icon registry, and both can be switched on while "Show
      // sites" itself stays off.
      attachOverlayIcons(instance)
      // Before the shared site overlay, so the frontier line sits under the
      // markers it runs past rather than over them.
      attachLimesOverlay(instance)
      keepLimesOverlayThroughStyleChanges(instance)
      attachPeriodOverlay(instance)
      keepPeriodOverlayThroughStyleChanges(instance)
      attachBattleOverlay(instance)
      keepBattleOverlayThroughStyleChanges(instance)
      attachPortOverlay(instance)
      keepPortOverlayThroughStyleChanges(instance)
      attachRouteOverlay(instance)
      keepRouteOverlayThroughStyleChanges(instance)
      attachFeatureOverlay(instance)
      keepFeatureOverlayThroughStyleChanges(instance)
      attachCoinHoardOverlay(instance)
      keepCoinHoardOverlayThroughStyleChanges(instance)
      attachInscriptionsOverlay(instance)
      keepInscriptionsOverlayThroughStyleChanges(instance)
      attachAtticInscriptionsOverlay(instance)
      keepAtticInscriptionsOverlayThroughStyleChanges(instance)
      syncReferenceOverlays(instance)
      keepReferenceOverlaysThroughStyleChanges(instance)
      attachModernLabelsOverlay(instance)
      keepModernLabelsOverlayThroughStyleChanges(instance)
      attachOverlay(instance)
      keepOverlayThroughStyleChanges(instance)
      refreshLimesDimming(instance)
      // No `keep*ThroughStyleChanges` companion — see the composable's own
      // docstring for why a delegated listener needs registering only once.
      attachAtlasPlaceOverlay(instance)
      // After the shared overlay, so the reader's rings draw above the markers
      // they annotate rather than under them.
      attachNotebookOverlay(instance)
      keepNotebookThroughStyleChanges(instance)
      keepTabulaPeutingerianaOverlayThroughStyleChanges(instance)
      isReady.value = true
    })

    instance.on('moveend', () => rememberCamera(readCamera(instance)))
    instance.on('click', (event) => handleFeatureTap(instance, event.point))

    // Sites, and every overlay icon that opens a popup: the layers' own `mouseenter`
    // handlers cannot be the answer, since this handler would overwrite them.
    instance.on('mousemove', (event) => {
      const isOverClickable =
        findFeaturesAtPoint(instance, event.point).length > 0 ||
        isOverClickableOverlay(instance, event.point)
      instance.getCanvas().style.cursor = isOverClickable ? 'pointer' : ''
    })

    map.value = instance

    /**
     * Loaded after the map is on screen, not before: the notebook is an
     * annotation and must never be on the critical path to the atlas itself.
     * A failure inside `load` is swallowed there for the same reason.
     */
    void loadNotebook()
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
      :aria-label="t('mapCanvas.ariaLabel')"
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
        <p class="eyebrow animate-pulse" role="status">{{ t('mapCanvas.loading') }}</p>
      </div>
    </Transition>

    <slot />
  </div>
</template>
