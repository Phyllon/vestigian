<script setup lang="ts">
  import { onClickOutside } from '@vueuse/core'

  /**
   * The overlay switches, in their own control rather than as a third group
   * inside the basemap menu.
   *
   * They were nested under the basemap switcher because they started as
   * readings of one particular sheet. None of them is any more — every one of
   * these draws over whichever basemap is showing — so a reader looking for
   * "show me the ports" had to open a menu named after the thing they were
   * *not* changing, scroll past two groups of radio buttons, and pick a
   * checkbox out of the bottom of it. Two controls, one for the sheet and one
   * for what is drawn on it, is what the interface actually models.
   *
   * The period scrubber and the Tabula Peutingeriana viewer link deliberately
   * stayed behind in `BasemapSwitcher`: the scrubber redraws the antiquity
   * sheet itself and only exists while that sheet is showing, and the viewer
   * link is another way of looking at the map, not a layer over it.
   */
  const {
    canFollowLimes,
    isFollowingLimes,
    setLimesActive,
    canShowTabulaPeutingerianaOverlay,
    isShowingTabulaPeutingerianaOverlay,
    setTabulaPeutingerianaOverlayActive,
    canShowBattles,
    isShowingBattles,
    setBattlesActive,
    canShowSites,
    isShowingSites,
    setSitesActive,
    canShowPorts,
    isShowingPorts,
    setPortsActive,
    canShowRoutes,
    isShowingRoutes,
    setRoutesActive,
    canShowFeatures,
    isShowingFeatures,
    setFeaturesActive,
    canShowCoinHoards,
    isShowingCoinHoards,
    setCoinHoardsActive,
    canShowInscriptions,
    isShowingInscriptions,
    setInscriptionsActive,
    canShowAtticInscriptions,
    isShowingAtticInscriptions,
    setAtticInscriptionsActive,
    canShowModernLabels,
    isShowingModernLabels,
    setModernLabelsActive,
    isShowingReferenceOverlay,
    setReferenceOverlayActive,
  } = useBasemapStyle()
  const { t } = useI18n()

  const isOpen = ref(false)
  const root = useTemplateRef('root')
  const trigger = useTemplateRef('trigger')

  const close = (): void => {
    isOpen.value = false
  }

  /**
   * Closing by keyboard has to hand focus back. Without it the reader is
   * returned to the top of the document and has to walk the whole control row
   * again to reach the button they just used.
   */
  const dismiss = (): void => {
    close()
    trigger.value?.focus()
  }

  /**
   * The menu deliberately stays open on a toggle. The switch changes the map
   * behind it rather than navigating anywhere, so closing would hide the only
   * feedback that anything happened — and a reader who wanted it off again
   * would have to reopen the menu to find out whether it was on.
   */
  interface OverlayToggle {
    key: string
    canShow: boolean
    isActive: boolean
    label: string
    hint: string
    setActive: (next: boolean) => void
  }

  const overlayToggles = computed<OverlayToggle[]>(() => [
    {
      key: 'sites',
      canShow: canShowSites.value,
      isActive: isShowingSites.value,
      label: t('basemapSwitcher.showSites'),
      hint: t('basemapSwitcher.showSitesHint'),
      setActive: setSitesActive,
    },
    {
      key: 'limes',
      canShow: canFollowLimes.value,
      isActive: isFollowingLimes.value,
      label: t('basemapSwitcher.followLimes'),
      hint: t('basemapSwitcher.followLimesHint'),
      setActive: setLimesActive,
    },
    {
      key: 'tabula-peutingeriana',
      canShow: canShowTabulaPeutingerianaOverlay.value,
      isActive: isShowingTabulaPeutingerianaOverlay.value,
      label: t('basemapSwitcher.tabulaPeutingerianaOverlay'),
      hint: t('basemapSwitcher.tabulaPeutingerianaOverlayHint'),
      setActive: setTabulaPeutingerianaOverlayActive,
    },
    {
      key: 'modern-labels',
      canShow: canShowModernLabels.value,
      isActive: isShowingModernLabels.value,
      label: t('basemapSwitcher.showModernLabels'),
      hint: t('basemapSwitcher.showModernLabelsHint'),
      setActive: setModernLabelsActive,
    },
    {
      key: 'battles',
      canShow: canShowBattles.value,
      isActive: isShowingBattles.value,
      label: t('basemapSwitcher.showBattles'),
      hint: t('basemapSwitcher.showBattlesHint'),
      setActive: setBattlesActive,
    },
    {
      key: 'ports',
      canShow: canShowPorts.value,
      isActive: isShowingPorts.value,
      label: t('basemapSwitcher.showPorts'),
      hint: t('basemapSwitcher.showPortsHint'),
      setActive: setPortsActive,
    },
    {
      key: 'routes',
      canShow: canShowRoutes.value,
      isActive: isShowingRoutes.value,
      label: t('basemapSwitcher.showRoutes'),
      hint: t('basemapSwitcher.showRoutesHint'),
      setActive: setRoutesActive,
    },
    {
      key: 'features',
      canShow: canShowFeatures.value,
      isActive: isShowingFeatures.value,
      label: t('basemapSwitcher.showFeatures'),
      hint: t('basemapSwitcher.showFeaturesHint'),
      setActive: setFeaturesActive,
    },
    {
      key: 'coin-hoards',
      canShow: canShowCoinHoards.value,
      isActive: isShowingCoinHoards.value,
      label: t('basemapSwitcher.showCoinHoards'),
      hint: t('basemapSwitcher.showCoinHoardsHint'),
      setActive: setCoinHoardsActive,
    },
    {
      key: 'inscriptions',
      canShow: canShowInscriptions.value,
      isActive: isShowingInscriptions.value,
      label: t('basemapSwitcher.showInscriptions'),
      hint: t('basemapSwitcher.showInscriptionsHint'),
      setActive: setInscriptionsActive,
    },
    {
      key: 'attic-inscriptions',
      canShow: canShowAtticInscriptions.value,
      isActive: isShowingAtticInscriptions.value,
      label: t('basemapSwitcher.showAtticInscriptions'),
      hint: t('basemapSwitcher.showAtticInscriptionsHint'),
      setActive: setAtticInscriptionsActive,
    },
    {
      key: 'isicily',
      canShow: true,
      isActive: isShowingReferenceOverlay('isicily'),
      label: t('basemapSwitcher.showIsicily'),
      hint: t('basemapSwitcher.showIsicilyHint'),
      setActive: (next) => setReferenceOverlayActive('isicily', next),
    },
    {
      key: 'roman-roads',
      canShow: true,
      isActive: isShowingReferenceOverlay('roman-roads'),
      label: t('basemapSwitcher.showRomanRoads'),
      hint: t('basemapSwitcher.showRomanRoadsHint'),
      setActive: (next) => setReferenceOverlayActive('roman-roads', next),
    },
    {
      key: 'road-audit',
      canShow: true,
      isActive: isShowingReferenceOverlay('road-audit'),
      label: t('basemapSwitcher.showRoadAudit'),
      hint: t('basemapSwitcher.showRoadAuditHint'),
      setActive: (next) => setReferenceOverlayActive('road-audit', next),
    },
    {
      key: 'monuments',
      canShow: true,
      isActive: isShowingReferenceOverlay('monuments'),
      label: t('basemapSwitcher.showMonuments'),
      hint: t('basemapSwitcher.showMonumentsHint'),
      setActive: (next) => setReferenceOverlayActive('monuments', next),
    },
    {
      key: 'mints',
      canShow: true,
      isActive: isShowingReferenceOverlay('mints'),
      label: t('basemapSwitcher.showMints'),
      hint: t('basemapSwitcher.showMintsHint'),
      setActive: (next) => setReferenceOverlayActive('mints', next),
    },
    {
      key: 'hillforts',
      canShow: true,
      isActive: isShowingReferenceOverlay('hillforts'),
      label: t('basemapSwitcher.showHillforts'),
      hint: t('basemapSwitcher.showHillfortsHint'),
      setActive: (next) => setReferenceOverlayActive('hillforts', next),
    },
  ])

  const activeCount = computed(
    () => overlayToggles.value.filter((entry) => entry.canShow && entry.isActive).length,
  )

  /**
   * Switches off every overlay this menu lists that is currently drawn, and
   * only those: the period scrubber and its neighbouring realms are a
   * separate control with their own state (`PeriodSwitcher.vue`), and a
   * reading of the sheet itself, not a layer over it.
   */
  const hideAll = (): void => {
    overlayToggles.value
      .filter((entry) => entry.canShow && entry.isActive)
      .forEach((entry) => entry.setActive(false))
  }

  /**
   * The count is the whole point of naming the closed button: with the panel
   * shut there is otherwise nothing on screen that says how many layers are
   * drawn over the sheet, and several of them (routes at a low zoom, coin
   * hoards outside Italy) are easy to have switched on without seeing.
   */
  const triggerLabel = computed<string>(() =>
    activeCount.value === 0
      ? t('overlaySwitcher.labelNone')
      : t('overlaySwitcher.labelActive', { count: activeCount.value }),
  )

  onClickOutside(root, close)
</script>

<template>
  <!--
    Escape delegate only, not a control of its own: the div is never focusable
    and has no role, it just catches the key while it bubbles up from the
    trigger button or the open menu beneath it.
  -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div ref="root" class="relative" @keydown.esc="dismiss">
    <button
      ref="trigger"
      type="button"
      class="leaf flex items-center gap-2 px-3 py-2 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-expanded="isOpen"
      :aria-label="triggerLabel"
      aria-haspopup="menu"
      aria-controls="overlay-choices"
      @click="isOpen = !isOpen"
    >
      <UIcon
        name="i-lucide-square-stack"
        class="size-4 text-oxide-600 dark:text-oxide-300"
        aria-hidden="true"
      />
      <!-- Hidden below `sm`, which is where most of the traffic is — the
           accessible name comes from `aria-label` above for that reason. -->
      <span class="hidden sm:inline">{{ t('overlaySwitcher.title') }}</span>
      <span
        v-if="activeCount > 0"
        class="min-w-5 rounded-full bg-oxide-600 px-1.5 text-center font-mono text-xs leading-5 text-paper-50 dark:bg-oxide-300 dark:text-night-900"
        aria-hidden="true"
      >
        {{ activeCount }}
      </span>
    </button>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <!--
        Capped against the viewport rather than sized to the content: eight
        switches is taller than a phone in landscape, and a menu that runs off
        the bottom of the screen has no way back.
      -->
      <div
        v-if="isOpen"
        id="overlay-choices"
        role="menu"
        :aria-label="t('overlaySwitcher.menuLabel')"
        class="leaf absolute right-0 top-full z-20 mt-2 max-h-[70vh] w-64 overflow-y-auto shadow-lifted"
      >
        <!--
          A toggle whose own `canShow` is false (the Tabula Peutingeriana
          network when the server withdraws it) is skipped rather than shown
          disabled. The neighbouring realms are not here at all: they only
          exist under the period scrubber, so their switch sits in its panel
          (`PeriodSwitcher.vue`).
        -->
        <!--
          An action, not a layer: no switch, no hint line, set apart by a plain
          text button pinned above the list so it stays reachable while the
          list scrolls. `aria-disabled` rather than `disabled` — the button is
          what has focus when the last overlay goes off, and a disabled button
          drops it back to the top of the document.
        -->
        <button
          type="button"
          role="menuitem"
          :aria-disabled="activeCount === 0"
          class="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-paper-300 bg-paper-50 px-4 py-2 text-left text-sm text-ink-700 transition hover:underline aria-disabled:cursor-default aria-disabled:text-ink-500 aria-disabled:no-underline dark:border-night-600 dark:bg-night-800 dark:text-paper-200 dark:aria-disabled:text-paper-400"
          @click="activeCount > 0 && hideAll()"
        >
          <UIcon name="i-lucide-eye-off" class="size-4 shrink-0" aria-hidden="true" />
          {{ t('overlaySwitcher.hideAll') }}
        </button>
        <template v-for="entry in overlayToggles" :key="entry.key">
          <button
            v-if="entry.canShow"
            type="button"
            role="menuitemcheckbox"
            :aria-checked="entry.isActive"
            class="flex w-full items-center gap-3 border-b border-paper-200 px-4 py-3 text-left transition last:border-b-0 hover:bg-paper-200 dark:border-night-700 dark:hover:bg-night-700"
            @click="entry.setActive(!entry.isActive)"
          >
            <span
              class="flex h-5 w-9 shrink-0 items-center rounded-full border transition"
              :class="
                entry.isActive
                  ? 'justify-end border-oxide-600 bg-oxide-600/20 dark:border-oxide-300'
                  : 'justify-start border-paper-300 bg-paper-200 dark:border-night-600 dark:bg-night-800'
              "
              aria-hidden="true"
            >
              <span
                class="mx-0.5 size-4 rounded-full transition"
                :class="
                  entry.isActive
                    ? 'bg-oxide-600 dark:bg-oxide-300'
                    : 'bg-paper-50 dark:bg-night-600'
                "
              />
            </span>
            <span class="flex flex-col gap-0.5">
              <span class="font-medium text-ink-900 dark:text-paper-100">{{ entry.label }}</span>
              <span class="text-xs text-ink-500 dark:text-paper-400">{{ entry.hint }}</span>
            </span>
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>
