<script setup lang="ts">
  import { MONUMENT_KINDS, REFERENCE_OVERLAY_IDS } from '#shared/utils/reference-overlays'
  import type { IconGlyph } from '~/composables/map/useSiteIcons'

  /**
   * The key to the marks on the map, drawn from the same path data the markers
   * are rasterised from, so the two cannot drift apart.
   *
   * Collapsed by default: on a phone the map is the whole screen, and a key
   * that covers a quarter of it to explain nine glyphs is a poor trade until
   * the reader asks for it.
   *
   * **It explains only what is drawn.** It used to open on the site glyphs and
   * the specific marks whatever was switched on — a key for markers the reader
   * had hidden, over a map that showed none of them. Every section is now gated
   * on its own switch, and with nothing on the panel says so rather than
   * showing a table that describes nothing.
   */
  const {
    view,
    periodYear,
    isShowingSites,
    isFollowingLimes,
    isShowingBattles,
    isShowingPorts,
    isShowingRoutes,
    isShowingFeatures,
    isShowingCoinHoards,
    isShowingInscriptions,
    isShowingAtticInscriptions,
    isShowingReferenceOverlay,
    isShowingPolities,
  } = useBasemapStyle()
  const { t } = useI18n()
  const isOpen = ref(false)

  const isShowingAnyReferenceOverlay = computed(() =>
    REFERENCE_OVERLAY_IDS.some((id) => isShowingReferenceOverlay(id)),
  )

  const hasKey = computed(
    () =>
      isShowingSites.value ||
      isFollowingLimes.value ||
      isShowingBattles.value ||
      isShowingPorts.value ||
      isShowingRoutes.value ||
      isShowingFeatures.value ||
      isShowingCoinHoards.value ||
      isShowingInscriptions.value ||
      isShowingAtticInscriptions.value ||
      isShowingAnyReferenceOverlay.value ||
      periodYear.value !== null,
  )

  /**
   * The frontier's line treatments, kept in step with the map by reading the
   * same colour table and dash array the style does (`LIMES_KIND_COLOURS`,
   * `LIMES_APPROXIMATE_DASH`). Colour says what a line is; dash says how far to
   * trust where it is drawn — so the key lists the three kinds solid, then the
   * dash once, rather than six near-identical rows.
   *
   * The swatch carries its own paper casing, as the line on the map does: the
   * casing is what the colour was contrast-checked against.
   */
  const LIMES_LINE_KEY = [
    { kind: 'barrier', labelKey: 'legend.frontierWall' },
    { kind: 'river', labelKey: 'legend.frontierRiver' },
    { kind: 'notional', labelKey: 'legend.frontierNoWorks' },
  ] as const

  const LIMES_SWATCH_WIDTH = 2.8
  const LIMES_SWATCH_DASHES = `${LIMES_APPROXIMATE_DASH[0] * LIMES_SWATCH_WIDTH} ${LIMES_APPROXIMATE_DASH[1] * LIMES_SWATCH_WIDTH}`

  /** The order the minor-features legend renders in — every `MinorFeatureKind`, once. */
  const MINOR_FEATURE_KINDS = [
    'bridge',
    'mine_quarry',
    'dam',
    'cemetery',
    'fort',
    'tumulus',
  ] as const

  /**
   * `fort` reuses the atlas fortification glyph, not a mark of its own — see
   * `minorFeatureIconId`'s own docstring. Every other kind is a lookup, and
   * every one of them (bridge, mine_quarry, dam, cemetery, tumulus) is
   * present in `MINOR_FEATURE_ICON_GLYPHS`.
   */
  const minorFeatureGlyph = (kind: (typeof MINOR_FEATURE_KINDS)[number]): IconGlyph =>
    kind === 'fort' ? SITE_ICON_GLYPHS.fortification : MINOR_FEATURE_ICON_GLYPHS[kind]!

  /** Kept beside `buildRouteLayer`'s own dash expression for the same reason
   *  `LIMES_LINE_KEY` is — an eight-pixel swatch, not the map's real dash array. */
  const ROUTE_LINE_KEY = [
    { kind: 'road', dashes: '4 2' },
    { kind: 'coastal', dashes: '2 2' },
    { kind: 'ferry', dashes: '1 2' },
  ] as const

  /**
   * Itiner-e's three certainty treatments, an eight-pixel swatch each — see
   * `buildRomanRoadLayers` for the real dash arrays. Bronze, like the layer.
   */
  const ROMAN_ROAD_LINE_KEY = [
    { certainty: 'certain', dashes: 'none' },
    { certainty: 'conjectured', dashes: '4 2' },
    { certainty: 'hypothetical', dashes: '1 2' },
  ] as const

  /** The single-mark reference overlays that share the key's icon-and-caption shape. */
  const REFERENCE_MARK_KEY = [
    {
      id: 'isicily',
      path: ISICILY_ICON_PATH,
      title: 'legend.isicilyTitle',
      mark: 'legend.isicilyMark',
    },
    { id: 'mints', path: MINT_ICON_PATH, title: 'legend.mintsTitle', mark: 'legend.mintMark' },
    {
      id: 'hillforts',
      path: HILLFORT_ICON_PATH,
      title: 'legend.hillfortsTitle',
      mark: 'legend.hillfortMark',
    },
  ] as const

  const toggle = (): void => {
    isOpen.value = !isOpen.value
  }
</script>

<template>
  <div class="flex flex-col items-start gap-2">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-1 opacity-0"
      leave-to-class="translate-y-1 opacity-0"
    >
      <div
        v-if="isOpen"
        id="map-legend"
        class="max-h-[min(70vh,32rem)] overflow-y-auto rounded-notebook border border-paper-300 bg-paper-50/95 p-3 shadow-leaf backdrop-blur-sm dark:border-night-600 dark:bg-night-800/95"
      >
        <h2 class="eyebrow mb-1">{{ t('legend.title') }}</h2>
        <p
          v-if="!hasKey"
          class="max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400"
          role="status"
        >
          {{ t('legend.emptyHint') }}
        </p>
        <p v-else class="mb-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400">
          {{ t('legend.tapForDetails') }}
        </p>

        <!-- The contributed sites' own marks: explained only while the sites are drawn. -->
        <template v-if="isShowingSites">
          <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <li v-for="category in SITE_CATEGORIES" :key="category" class="flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                class="h-5 w-5 shrink-0"
                aria-hidden="true"
                fill="none"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10.4"
                  class="fill-paper-50 stroke-paper-500 dark:fill-night-800 dark:stroke-paper-800"
                  stroke-width="1"
                />
                <path
                  v-if="SITE_ICON_GLYPHS[category].filled"
                  :d="SITE_ICON_GLYPHS[category].path"
                  :transform="`translate(${GAME_ICON_OFFSET} ${GAME_ICON_OFFSET}) scale(${GAME_ICON_SCALE})`"
                  class="fill-bronze-600 dark:fill-bronze-300"
                />
                <path
                  v-else
                  :d="SITE_ICON_GLYPHS[category].path"
                  class="stroke-bronze-600 dark:stroke-bronze-300"
                />
              </svg>

              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`categories.${category}`) }}
              </span>
            </li>
          </ul>

          <!--
          vici's own `subcategory` on the site layer above: gated with it, since
          these marks are drawn by the same layer and by nothing else.
        -->
          <h2 class="eyebrow mb-1 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.siteMarksTitle') }}
          </h2>

          <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <li v-for="mark in SITE_MARK_KINDS" :key="mark" class="flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                class="h-5 w-5 shrink-0"
                aria-hidden="true"
                fill="none"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10.4"
                  class="fill-paper-50 stroke-paper-500 dark:fill-night-800 dark:stroke-paper-800"
                  stroke-width="1"
                />
                <path
                  v-if="SITE_MARK_ICON_GLYPHS[mark].filled"
                  :d="SITE_MARK_ICON_GLYPHS[mark].path"
                  :transform="`translate(${GAME_ICON_OFFSET} ${GAME_ICON_OFFSET}) scale(${GAME_ICON_SCALE})`"
                  class="fill-bronze-600 dark:fill-bronze-300"
                />
                <path
                  v-else
                  :d="SITE_MARK_ICON_GLYPHS[mark].path"
                  :transform="
                    SITE_MARK_ICON_GLYPHS[mark].inset
                      ? `translate(${OUTLINE_INSET_OFFSET} ${OUTLINE_INSET_OFFSET}) scale(${OUTLINE_INSET_SCALE})`
                      : undefined
                  "
                  vector-effect="non-scaling-stroke"
                  class="stroke-bronze-600 dark:stroke-bronze-300"
                />
              </svg>

              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`siteMarks.${mark}`) }}
              </span>
            </li>
          </ul>

          <!--
          The antiquity sheet carries twenty-two thousand places borrowed from
          Pleiades alongside the records contributed here, and the borrowed ones
          outnumber them. Same glyphs, drawn without the disc — so the reader can
          tell the atlas from the work without being told twice.
        -->
          <p
            v-if="isAntiquityView(view)"
            class="mt-2.5 max-w-64 border-t border-paper-300 pt-2 text-xs leading-snug text-ink-500 dark:border-night-600 dark:text-paper-400"
          >
            {{ t('legend.referencedNote') }}
          </p>
        </template>

        <!--
          Basemap credit, per layer — DARE's own terms require attribution and
          a link, and neither AWMC (ODbL) nor Pleiades (CC BY) is used without
          one either. See /licence for the full terms.
        -->
        <p
          v-if="hasKey && view === 'antiquity-dare'"
          class="mt-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400"
        >
          {{ t('legend.basemapCreditDare') }}
          <a
            href="https://dh.gu.se/geography/imperium/"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
          >
            dh.gu.se
          </a>
        </p>
        <p
          v-else-if="hasKey && view === 'antiquity-awmc'"
          class="mt-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400"
        >
          {{ t('legend.basemapCreditBarrington') }}
        </p>

        <!--
          The frontier's own key, added rather than substituted: the note above
          is still true while it is showing, and the plans below replace the
          crenellation only for fortifications on the line.
        -->
        <template v-if="isFollowingLimes">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.frontierTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li v-for="line in LIMES_LINE_KEY" :key="line.kind" class="flex items-center gap-2">
              <svg class="h-2.5 w-8 shrink-0" viewBox="0 0 32 10" aria-hidden="true">
                <path d="M0 5h32" stroke="#faf7ef" stroke-width="6.5" />
                <path
                  d="M0 5h32"
                  :stroke="LIMES_KIND_COLOURS[line.kind]"
                  :stroke-width="LIMES_SWATCH_WIDTH"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">{{ t(line.labelKey) }}</span>
            </li>
          </ul>

          <!--
            Solid and dashed, once, in neutral ink: the dash is a statement about
            every colour above it, not a fourth kind of frontier.
          -->
          <ul class="mt-2 flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="h-2.5 w-8 shrink-0" viewBox="0 0 32 10" aria-hidden="true">
                <path d="M0 5h32" stroke="#faf7ef" stroke-width="6.5" />
                <path d="M0 5h32" stroke="#2b2621" :stroke-width="LIMES_SWATCH_WIDTH" />
              </svg>
              <span class="max-w-52 text-xs leading-snug text-ink-700 dark:text-paper-200">
                {{ t('legend.frontierTraced') }}
              </span>
            </li>
            <li class="flex items-start gap-2">
              <svg class="mt-0.5 h-2.5 w-8 shrink-0" viewBox="0 0 32 10" aria-hidden="true">
                <path d="M0 5h32" stroke="#faf7ef" stroke-width="6.5" />
                <path
                  d="M0 5h32"
                  stroke="#2b2621"
                  :stroke-width="LIMES_SWATCH_WIDTH"
                  :stroke-dasharray="LIMES_SWATCH_DASHES"
                />
              </svg>
              <span class="max-w-52 text-xs leading-snug text-ink-700 dark:text-paper-200">
                {{ t('legend.frontierApproximate') }}
              </span>
            </li>
          </ul>

          <ul class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <li v-for="mark in LIMES_MARKS" :key="mark" class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="LIMES_ICON_PATHS[mark]"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`limesMarks.${mark}`) }}
              </span>
            </li>
          </ul>

          <!--
            `limes-installations` (the Pleiades-sourced military places
            promoted to these plan marks) reads the `atlas` vector source,
            which only exists on the Barrington sheet — see the docstring on
            `useLimesOverlay`'s `attachLimesOverlay`. The frontier line itself
            still draws on every basemap; only these marks don't.
          -->
          <p
            v-if="view !== 'antiquity-awmc'"
            class="mt-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400"
          >
            {{ t('legend.frontierMarksBarringtonOnly') }}
          </p>
        </template>

        <!--
          Battles are an overlay on any basemap, not a reading of the
          Barrington sheet — its own key entry, not folded into the
          frontier's, so it still shows when the frontier switch is off.
        -->
        <template v-if="isShowingBattles">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.battlesTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="BATTLE_ICON_PATH"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.battleMark') }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Ports are an overlay on any basemap, own key entry, same reasoning
          as battles above.
        -->
        <template v-if="isShowingPorts">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.portsTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="PORT_ICON_PATH"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.portMark') }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Routes are an overlay on any basemap, own key entry, same reasoning
          as battles above. Dash patterns only, one hue — see `ROUTE_LINE_KEY`.
        -->
        <template v-if="isShowingRoutes">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.routesTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li v-for="line in ROUTE_LINE_KEY" :key="line.kind" class="flex items-center gap-2">
              <svg class="h-2 w-8 shrink-0" viewBox="0 0 32 8" aria-hidden="true">
                <path
                  d="M0 4h32"
                  stroke="#8c8271"
                  stroke-width="1.5"
                  :stroke-dasharray="line.dashes"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`legend.routeKind.${line.kind}`) }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Minor features are an overlay on any basemap, own key entry, same
          reasoning as battles above. `fort` reuses the atlas fortification
          glyph (`SITE_ICON_GLYPHS.fortification`), not a mark of its own —
          see `minorFeatureIconId`'s own docstring.
        -->
        <template v-if="isShowingFeatures">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.featuresTitle') }}
          </h2>

          <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <li v-for="kind in MINOR_FEATURE_KINDS" :key="kind" class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  v-if="minorFeatureGlyph(kind).filled"
                  :d="minorFeatureGlyph(kind).path"
                  :transform="`translate(${GAME_ICON_OFFSET} ${GAME_ICON_OFFSET}) scale(${GAME_ICON_SCALE})`"
                  fill="currentColor"
                />
                <path
                  v-else
                  :d="minorFeatureGlyph(kind).path"
                  stroke="currentColor"
                  stroke-width="1.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`minorFeaturePopup.kind.${kind}`) }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Coin hoards are an overlay on any basemap, own key entry, same
          reasoning as battles above.
        -->
        <template v-if="isShowingCoinHoards">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.coinHoardsTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="COIN_HOARD_ICON_PATH"
                  stroke="currentColor"
                  stroke-width="1.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.coinHoardMark') }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Inscriptions are an overlay on any basemap, own key entry, same
          reasoning as battles and coin hoards above.
        -->
        <template v-if="isShowingInscriptions">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.inscriptionsTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="INSCRIPTION_ICON_PATH"
                  stroke="currentColor"
                  stroke-width="1.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.inscriptionMark') }}
              </span>
            </li>
          </ul>
        </template>

        <!-- Attic Inscriptions Online — a second, smaller corpus, own key entry. -->
        <template v-if="isShowingAtticInscriptions">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.atticInscriptionsTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="ATTIC_INSCRIPTION_ICON_PATH"
                  stroke="currentColor"
                  stroke-width="1.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.atticInscriptionMark') }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Itiner-e's roads: told apart by certainty, not by colour — a surveyed
          road is solid, a conjectured one dashed, a hypothetical one dotted.
        -->
        <template v-if="isShowingReferenceOverlay('roman-roads')">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.romanRoadsTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li
              v-for="line in ROMAN_ROAD_LINE_KEY"
              :key="line.certainty"
              class="flex items-center gap-2"
            >
              <svg class="h-2 w-8 shrink-0" viewBox="0 0 32 8" aria-hidden="true">
                <path
                  d="M0 4h32"
                  stroke="#5d5237"
                  stroke-width="1.8"
                  :stroke-dasharray="line.dashes"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`legend.romanRoadKind.${line.certainty}`) }}
              </span>
            </li>
          </ul>
        </template>

        <!--
          Monuments carry a mark per kind, so the key lists every one. Marks the atlas
          already draws elsewhere (villa, temple, fort, bridge, aqueduct) are the same
          glyphs; see `MONUMENT_ICON_GLYPHS`.
        -->
        <template v-if="isShowingReferenceOverlay('monuments')">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.monumentsTitle') }}
          </h2>

          <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <li v-for="kind in MONUMENT_KINDS" :key="kind" class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  v-if="MONUMENT_ICON_GLYPHS[kind].filled"
                  :d="MONUMENT_ICON_GLYPHS[kind].path"
                  :transform="`translate(${GAME_ICON_OFFSET} ${GAME_ICON_OFFSET}) scale(${GAME_ICON_SCALE})`"
                  fill="currentColor"
                />
                <path
                  v-else
                  :d="MONUMENT_ICON_GLYPHS[kind].path"
                  stroke="currentColor"
                  stroke-width="1.1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t(`referencePopup.monument.kind.${kind}`) }}
              </span>
            </li>
          </ul>
        </template>

        <!-- Mints and I.Sicily and the hillforts: one mark each, own key entry like coin hoards. -->
        <template v-for="entry in REFERENCE_MARK_KEY" :key="entry.id">
          <template v-if="isShowingReferenceOverlay(entry.id)">
            <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
              {{ t(entry.title) }}
            </h2>

            <ul class="flex flex-col gap-1.5">
              <li class="flex items-center gap-2">
                <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    :d="entry.path"
                    stroke="currentColor"
                    stroke-width="1.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="text-xs text-ink-700 dark:text-paper-200">
                  {{ t(entry.mark) }}
                </span>
              </li>
            </ul>
          </template>
        </template>

        <!--
          The scrubber's two fills, keyed together: the Roman state in its own
          amber, and — when their switch is on — the realms around it in blue.
          Drawn only while a date is chosen.
        -->
        <template v-if="periodYear !== null">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.empiresTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  fill="#c99b52"
                  fill-opacity="0.4"
                  stroke="#6b4d17"
                  stroke-width="1.6"
                  stroke-dasharray="5 2.5"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.romanExtentMark') }}
              </span>
            </li>
            <li v-if="isShowingPolities" class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  fill="#2a5d8f"
                  fill-opacity="0.4"
                  stroke="#0f2f52"
                  stroke-width="1.6"
                  stroke-dasharray="3 2"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ t('legend.politiesMark') }}
              </span>
            </li>
          </ul>
        </template>
      </div>
    </Transition>

    <UButton
      color="neutral"
      variant="outline"
      size="xs"
      icon="i-lucide-key-round"
      class="shadow-leaf"
      :aria-expanded="isOpen"
      aria-controls="map-legend"
      @click="toggle"
    >
      {{ isOpen ? t('legend.hideKey') : t('legend.showKey') }}
    </UButton>
  </div>
</template>
