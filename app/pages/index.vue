<script setup lang="ts">
  import { buildWebSiteJsonLd } from '#shared/utils/structuredData'

  const { t } = useI18n()
  const { loggedIn } = useSession()
  const { isFollowingLimes } = useBasemapStyle()
  const { selectSite } = useSiteQuery()
  const config = useRuntimeConfig()

  const isContributing = ref(false)
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('indexPage.title') })
  useCanonicalUrl()

  useSocialMeta({
    title: 'Vestigia',
    description: t('indexPage.description'),
    imageUrl: `${base}/og/default.png`,
  })

  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(buildWebSiteJsonLd({ siteUrl: base, name: 'Vestigia' })),
      },
    ],
  })

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
    <!--
      The map is the page, so the page's only heading has nothing to draw. It
      is still the first thing a screen reader looks for, and the record panels
      below it are headed at level two on the strength of it.
    -->
    <h1 class="sr-only">{{ t('indexPage.srHeading') }}</h1>

    <!--
      Controls float over the map; the map itself never scrolls or reflows.

      Padded clear of the frontier panel on wide screens, where that panel is a
      rail down the left edge and would otherwise sit on top of the search field
      and the key. On a phone the panel is a bottom sheet and there is nothing
      to move out of the way of.
    -->
    <div
      class="pointer-events-none absolute inset-0 p-3 transition-[padding] md:p-4"
      :class="isFollowingLimes ? 'md:pl-[23rem]' : ''"
    >
      <div class="pointer-events-auto flex items-start gap-2">
        <div class="w-full max-w-sm">
          <MapSearchField />
        </div>
        <MapBasemapSwitcher class="ml-auto" />
      </div>

      <!--
        `absolute` ignores the container's padding, so the frontier panel has to
        be cleared here as well as above — without this the key sits underneath
        the panel on a wide screen and cannot be opened.
      -->
      <MapLegend
        class="pointer-events-auto absolute bottom-4 left-3 md:left-4"
        :class="isFollowingLimes ? 'md:left-[23.5rem]' : ''"
      />

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
          {{ t('indexPage.addToAtlas') }}
        </UButton>
      </div>

      <!--
        `Lazy`, and it is worth more than it looks. `v-if` decides what renders,
        never what ships: the static chain from here through ContributionPanel
        and TracingEditorForm reaches GeometryDrawTool, so terra-draw, its
        MapLibre adapter, zod and ImageUploader were all being downloaded with
        the map — for a panel a signed-out visitor cannot even open. The prefix
        makes it an async chunk fetched when someone clicks to contribute.
      -->
      <LazyContributeContributionPanel
        v-if="isContributing"
        class="pointer-events-auto"
        @close="stopContributing"
      />
    </div>

    <!--
      Same reasoning, smaller prize. All three are instantiated on every load
      but show nothing until a mark is tapped. Order matters: the picker sits
      above the detail panels — see MapFeaturePicker.
      "Lazy" left the modulepreload graph, so it's off the critical path rather than blocking. But it's still downloaded.
    -->
    <!--
      Only while the frontier is showing. Lazy for the same reason as the
      panels below: a reader who never turns the switch on should not download
      the roll, its formatting or the sector fetch.
    -->
    <LazyLimesPanel v-if="isFollowingLimes" />

    <LazyMapFeaturePicker />
    <LazySiteDetailPanel />
    <LazyTracingDetailPanel />
  </MapCanvas>
</template>
