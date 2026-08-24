<script setup lang="ts">
  const { loggedIn } = useSession()
  const { selectSite } = useSiteQuery()

  const isContributing = ref(false)

  useHead({ title: 'Map' })

  const startContributing = (): void => {
    selectSite(null)
    isContributing.value = true
  }

  const stopContributing = (): void => {
    isContributing.value = false
  }
</script>

<template>
  <MapCanvas>
    <!-- Controls float over the map; the map itself never scrolls or reflows. -->
    <div class="pointer-events-none absolute inset-0 p-3 md:p-4">
      <div class="pointer-events-auto flex items-start gap-2">
        <div class="w-full max-w-sm">
          <MapSearchField />
        </div>
        <MapBasemapSwitcher class="ml-auto" />
      </div>

      <MapLegend class="pointer-events-auto absolute bottom-4 left-3 md:left-4" />

      <!--
        Clear of MapLibre's own chrome. The compact attribution control — the
        (i) — is fixed to the bottom right of the canvas at 24px tall with a
        10px margin, so anything below 34px from the bottom edge lands on top
        of it. It is not ours to move: the attribution has to stay reachable.
      -->
      <div
        class="pointer-events-auto absolute bottom-12 right-3 flex flex-col items-end gap-2 md:right-4"
      >
        <MapGeolocateButton />

        <UButton
          v-if="loggedIn && !isContributing"
          color="primary"
          icon="i-lucide-map-pin-plus"
          class="shadow-leaf"
          @click="startContributing"
        >
          Add to the atlas
        </UButton>
      </div>

      <ContributeContributionPanel
        v-if="isContributing"
        class="pointer-events-auto"
        @close="stopContributing"
      />
    </div>

    <MapFeaturePicker />
    <SiteDetailPanel />
    <TracingDetailPanel />
  </MapCanvas>
</template>
