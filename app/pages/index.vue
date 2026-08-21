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

      <div
        class="pointer-events-auto absolute bottom-4 right-3 flex flex-col items-end gap-2 md:right-4"
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

    <SiteDetailPanel />
    <TracingDetailPanel />
  </MapCanvas>
</template>
