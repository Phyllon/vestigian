<script setup lang="ts">
  import type { IconGlyph } from '~/composables/map/useSiteIcons'

  /**
   * The key to the marks on the map, drawn from the same path data the markers
   * are rasterised from, so the two cannot drift apart.
   *
   * Collapsed by default: on a phone the map is the whole screen, and a key
   * that covers a quarter of it to explain nine glyphs is a poor trade until
   * the reader asks for it.
   */
  const {
    view,
    isFollowingLimes,
    isShowingBattles,
    isShowingPorts,
    isShowingRoutes,
    isShowingFeatures,
    isShowingCoinHoards,
  } = useBasemapStyle()
  const { t } = useI18n()
  const isOpen = ref(false)

  /**
   * The three line treatments, kept beside the paths they describe rather than
   * imported from the style: these are eight-pixel swatches on a legend, not
   * the map's own dash arrays, and matching them exactly would make the key
   * unreadable at this size.
   */
  const LIMES_LINE_KEY = [
    { kind: 'barrier', label: 'Wall, rampart or ditch', dashes: 'none' },
    { kind: 'river', label: 'River frontier, held from the bank', dashes: '7 3' },
    { kind: 'notional', label: 'Frontier without built works', dashes: '3 2.5' },
  ]

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
        <p class="mb-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400">
          {{ t('legend.tapForDetails') }}
        </p>

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
                class="fill-ink-800 dark:fill-paper-200"
              />
              <path
                v-else
                :d="SITE_ICON_GLYPHS[category].path"
                :class="
                  category === 'infrastructure'
                    ? 'stroke-bronze-600 dark:stroke-bronze-300'
                    : 'stroke-ink-800 dark:stroke-paper-200'
                "
              />
            </svg>

            <span class="text-xs text-ink-700 dark:text-paper-200">
              {{ t(`categories.${category}`) }}
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

        <!--
          Basemap credit, per layer — DARE's own terms require attribution and
          a link, and neither AWMC (ODbL) nor Pleiades (CC BY) is used without
          one either. See /licence for the full terms.
        -->
        <p
          v-if="view === 'antiquity-dare'"
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
          v-else-if="view === 'antiquity-awmc'"
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
              <svg class="h-2 w-8 shrink-0" viewBox="0 0 32 8" aria-hidden="true">
                <path
                  d="M0 4h32"
                  stroke="#9a3b22"
                  stroke-width="2.5"
                  :stroke-dasharray="line.dashes"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">{{ line.label }}</span>
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
