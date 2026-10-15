<script setup lang="ts">
  import { buildWebSiteJsonLd } from '#shared/utils/structuredData'

  const { t } = useI18n()
  const { loggedIn } = useSession()
  const { isFollowingLimes, isShowingSites, setLimesActive } = useBasemapStyle()
  const { selectSite, clearSelection, isPanelOpen, isTracingPanelOpen, isPickerOpen } =
    useSiteQuery()

  /**
   * `SiteDetailPanel`/`TracingDetailPanel`/`FeaturePicker` are `absolute`
   * overlays, not layout participants — opening one never resizes this
   * wrapper, so without this the whole right-hand control column (overlays,
   * period, basemap, offline download, geolocate) stayed exactly where it
   * was and simply vanished under the panel's `z-30`, the moment a reader
   * tapped a marker. Reported as the controls "jumping"; nothing actually
   * moved, they were fully hidden the entire time a panel stayed open.
   * Mirrors `isFollowingLimes`'s `md:pl-[23rem]` clearance for the frontier
   * panel on the left, one rem past the panel's own `md:w-[26rem]`.
   */
  const isRecordPanelOpen = computed(
    () => isPanelOpen.value || isTracingPanelOpen.value || isPickerOpen.value,
  )

  /**
   * Phone only (the classes below are `max-md`): a record sheet folded to its
   * handle is ~113px tall — row plus the 40px floor `pb-10` — which would sit
   * over the lowest buttons, exactly as the folded frontier sheet did.
   */
  const isRecordSheetFolded = useIsRecordSheetFolded()
  const controlColumnLift = computed(() => {
    if (isRecordPanelOpen.value && isRecordSheetFolded.value) return 'max-md:bottom-32'
    if (isFollowingLimes.value) return 'max-md:bottom-28'
    return ''
  })
  const config = useRuntimeConfig()
  const { isOpen: isIntroOpen, openIfNew: openIntroIfNew } = useIntroTour()

  const isContributing = ref(false)
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('indexPage.title') })
  useCanonicalUrl()

  useSocialMeta({
    title: 'Vestigian',
    description: t('indexPage.description'),
    imageUrl: `${base}/og/default.png`,
  })

  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(buildWebSiteJsonLd({ siteUrl: base, name: 'Vestigian' })),
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

  /**
   * Everything that can sit over a control the tour points at is closed the
   * moment it opens — a record, a tracing, the overlap picker, the contribution
   * form and the frontier panel (the key and the expanded credits close
   * themselves, `Legend.vue` and `IntroTour.vue`). A `z-30` panel hides the
   * right-hand control column, and on a phone the frontier is a bottom sheet
   * over the legend, the column and the credits; a replay from the menu is the
   * usual way to hit this, since the first-visit offer already refuses to open
   * over a record.
   *
   * A pre-flush watcher, so the panels are gone in the same render that mounts
   * the tour and its `onMounted` measures the finished layout.
   *
   * Two things are given up, and neither comes back when the tour ends: a
   * contribution draft in progress is discarded, and the frontier overlay is
   * switched off (it is the reader's own choice; the tour does not turn it
   * back on).
   */
  watch(isIntroOpen, (isOpen) => {
    if (!isOpen) return
    clearSelection()
    isContributing.value = false
    setLimesActive(false)
  })

  /**
   * Offered once the map has had a moment to appear, so the first thing a new
   * visitor sees is the atlas and not a dimmed loading screen. Never over an
   * open record: a shared link to a site is someone who came for that site,
   * and the panel moves the controls the tour would point at.
   */
  const INTRO_DELAY_MS = 1200

  onMounted(() => {
    window.setTimeout(() => {
      if (!isRecordPanelOpen.value) openIntroIfNew()
    }, INTRO_DELAY_MS)
  })
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
      :class="[isFollowingLimes ? 'md:pl-[23rem]' : '', isRecordPanelOpen ? 'md:pr-[27rem]' : '']"
    >
      <div class="pointer-events-auto flex items-start gap-2">
        <div class="w-full max-w-sm" data-tour="search">
          <MapSearchField />
        </div>
        <!--
          Three controls, not one menu: the sheet under the map, what is
          drawn over it, and when it is drawn as of. See `OverlaySwitcher.vue`
          and `PeriodSwitcher.vue` for why each split out on its own.
        -->
        <MapOverlaySwitcher class="ml-auto" data-tour="overlays" />
        <MapPeriodSwitcher data-tour="period" />
        <MapBasemapSwitcher data-tour="basemap" />
      </div>

      <!--
        `absolute` ignores the container's padding, so the frontier panel has to
        be cleared here as well as above — without this the key sits underneath
        the panel on a wide screen and cannot be opened. `bottom-2.5` is
        MapLibre's own 10px credit margin, so the key and the (i) share a line.
      -->
      <MapLegend
        class="pointer-events-auto absolute bottom-2.5 left-3 z-30 md:left-4"
        data-tour="legend"
        :class="isFollowingLimes ? 'md:left-[23.5rem]' : ''"
      >
        <!--
          The scale rides the key's own row (and so its clearance of the
          frontier panel, the featured list and the credit) rather than the
          canvas corner MapLibre would put it in, where it would sit under the key.
        -->
        <template #beside>
          <MapScale />
        </template>
      </MapLegend>

      <!--
        Clear of MapLibre's own chrome. The compact attribution control — the
        (i) — is fixed to the bottom right of the canvas at 24px tall with a
        10px margin, so anything below 34px from the bottom edge lands on top
        of it. It is not ours to move: the attribution has to stay reachable.
      -->
      <!--
        Above the frontier sheet's folded height on a phone (`LimesPanel`'s own
        floor included): the sheet is `z-20` over this column, so at the usual
        `bottom-12` the lowest button was half buried under it.
      -->
      <div
        class="pointer-events-auto absolute bottom-12 right-3 flex flex-col items-end gap-2 md:right-4"
        :class="controlColumnLift"
      >
        <!--
          Lazy and only while the sites are drawn: it narrows a layer that is off
          by default, so most visitors never download it. Above the gear, so the
          buttons below it stay where they were when it appears.
        -->
        <LazyMapSiteTypeFilter v-if="isShowingSites" />
        <MapSettingsMenu />
        <MapOfflineDownloadControl data-tour="offline" />
        <!-- Beside the locate button it works with: it turns the map, that one moves it. -->
        <MapCompassButton />
        <MapGeolocateButton data-tour="geolocate" />

        <UButton
          v-if="loggedIn && !isContributing"
          color="primary"
          icon="i-lucide-map-pin-plus"
          class="shadow-leaf"
          data-tour="contribute"
          @click="startContributing"
        >
          {{ t('indexPage.addToAtlas') }}
        </UButton>
      </div>

      <MapFeaturedSitesPanel />

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
    -->
    <!--
      Only while the frontier is showing. Lazy for the same reason as the
      panels below: a reader who never turns the switch on should not download
      the roll, its formatting or the sector fetch.
    -->
    <LazyLimesPanel v-if="isFollowingLimes" />

    <!-- Lazy and `v-if`: a visitor who has already answered never downloads it. -->
    <LazyOnboardingIntroTour v-if="isIntroOpen" />

    <MapFeaturePicker />
    <SiteDetailPanel />
    <TracingDetailPanel />
  </MapCanvas>
</template>
