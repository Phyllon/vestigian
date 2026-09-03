<script setup lang="ts">
  import { onClickOutside } from '@vueuse/core'
  import type { BasemapGroup, BasemapView } from '#shared/types'

  const {
    view,
    setView,
    availableViews,
    canFollowLimes,
    isFollowingLimes,
    setLimesActive,
    canShowTabulaPeutingerianaOverlay,
    isShowingTabulaPeutingerianaOverlay,
    setTabulaPeutingerianaOverlayActive,
  } = useBasemapStyle()
  const { t } = useI18n()
  const isOpen = ref(false)
  const root = useTemplateRef('root')
  const trigger = useTemplateRef('trigger')

  const groups: BasemapGroup[] = ['today', 'antiquity']

  const groupLabels = computed<Record<BasemapGroup, string>>(() => ({
    today: t('basemapSwitcher.groupToday'),
    antiquity: t('basemapSwitcher.groupAntiquity'),
  }))

  const viewsInGroup = (group: BasemapGroup) =>
    availableViews.filter((option) => option.group === group)

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

  const choose = (next: BasemapView): void => {
    setView(next)
    close()
  }

  /**
   * The menu deliberately stays open. The switch changes the sheet behind it
   * rather than navigating anywhere, so closing would hide the only feedback
   * that anything happened — and a reader who wanted it off again would have to
   * reopen the menu to find out whether it was on.
   */
  const toggleLimes = (): void => {
    setLimesActive(!isFollowingLimes.value)
  }

  const toggleTabulaPeutingerianaOverlay = (): void => {
    setTabulaPeutingerianaOverlayActive(!isShowingTabulaPeutingerianaOverlay.value)
  }

  /**
   * Both switches on any basemap now — the frontier stopped being a reading
   * of the Barrington sheet specifically (see `isFollowingLimes` in
   * `useBasemapStyle`) — so they sit together in one group rather than one
   * being nested under the antiquity options and the other floating below
   * both groups. `canShow` is always true for the frontier and reflects the
   * server-side licence gate for the Tabula Peutingeriana network.
   */
  interface OverlayToggle {
    key: string
    canShow: boolean
    isActive: boolean
    label: string
    hint: string
    toggle: () => void
  }

  const overlayToggles = computed<OverlayToggle[]>(() => [
    {
      key: 'limes',
      canShow: canFollowLimes.value,
      isActive: isFollowingLimes.value,
      label: t('basemapSwitcher.followLimes'),
      hint: t('basemapSwitcher.followLimesHint'),
      toggle: toggleLimes,
    },
    {
      key: 'tabula-peutingeriana',
      canShow: canShowTabulaPeutingerianaOverlay.value,
      isActive: isShowingTabulaPeutingerianaOverlay.value,
      label: t('basemapSwitcher.tabulaPeutingerianaOverlay'),
      hint: t('basemapSwitcher.tabulaPeutingerianaOverlayHint'),
      toggle: toggleTabulaPeutingerianaOverlay,
    },
  ])

  const activeLabel = computed(
    () => availableViews.find((option) => option.value === view.value)?.label ?? 'Vestigian',
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
    <!--
      The label is hidden below `sm`, which is where most of the traffic is, so
      the accessible name cannot come from it: on a phone this was a button
      with no name at all, announced as "button".
    -->
    <button
      ref="trigger"
      type="button"
      class="leaf flex items-center gap-2 px-3 py-2 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-expanded="isOpen"
      :aria-label="t('basemapSwitcher.label', { label: activeLabel })"
      aria-haspopup="menu"
      aria-controls="basemap-choices"
      @click="isOpen = !isOpen"
    >
      <UIcon
        name="i-lucide-layers"
        class="size-4 text-oxide-600 dark:text-oxide-300"
        aria-hidden="true"
      />
      <span class="hidden sm:inline">{{ activeLabel }}</span>
    </button>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <!--
        Capped against the viewport rather than sized to the content: four
        entries in two groups plus the frontier switch is taller than a phone in
        landscape, and a menu that runs off the bottom of the screen has no way
        back.
      -->
      <div
        v-if="isOpen"
        id="basemap-choices"
        role="menu"
        :aria-label="t('basemapSwitcher.menuLabel')"
        class="leaf absolute right-0 top-full z-20 mt-2 max-h-[70vh] w-64 overflow-y-auto shadow-lifted"
      >
        <div v-for="group in groups" :key="group" role="group" :aria-label="groupLabels[group]">
          <p
            class="eyebrow border-b border-paper-200 px-4 pb-1 pt-3 text-ink-500 dark:border-night-700 dark:text-paper-400"
          >
            {{ groupLabels[group] }}
          </p>

          <button
            v-for="option in viewsInGroup(group)"
            :key="option.value"
            type="button"
            role="menuitemradio"
            :aria-checked="option.value === view"
            class="flex w-full flex-col items-start gap-0.5 border-b border-paper-200 px-4 py-3 text-left transition last:border-b-0 hover:bg-paper-100 dark:border-night-700 dark:hover:bg-night-700"
            :class="option.value === view ? 'bg-paper-100 dark:bg-night-700' : ''"
            @click="choose(option.value)"
          >
            <span class="flex w-full items-center justify-between gap-2">
              <span class="font-medium text-ink-900 dark:text-paper-100">{{ option.label }}</span>
              <UIcon
                v-if="option.value === view"
                name="i-lucide-check"
                class="size-4 shrink-0 text-oxide-600 dark:text-oxide-300"
                aria-hidden="true"
              />
            </span>
            <span class="text-xs text-ink-500 dark:text-paper-400">{{ option.hint }}</span>
          </button>

          <!--
            Not a radio: the Tabula Peutingeriana is a schematic route
            diagram, not a georeferenced sheet, so it has no state to select
            here — it leaves the map for its own deep-zoom viewer instead.
            `role="menuitem"`, the plain-action role, rather than the radio or
            checkbox roles above it.
          -->
          <NuxtLink
            v-if="group === 'antiquity'"
            to="/tabula-peutingeriana"
            role="menuitem"
            class="flex w-full items-center justify-between gap-3 border-t border-paper-200 px-4 py-3 text-left transition hover:bg-paper-200 dark:border-night-700 dark:hover:bg-night-700"
            @click="close"
          >
            <span class="flex flex-col gap-0.5">
              <span class="font-medium text-ink-900 dark:text-paper-100">
                {{ t('basemapSwitcher.tabulaPeutingeriana') }}
              </span>
              <span class="text-xs text-ink-500 dark:text-paper-400">
                {{ t('basemapSwitcher.tabulaPeutingerianaHint') }}
              </span>
            </span>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-4 shrink-0 text-ink-500 dark:text-paper-400"
              aria-hidden="true"
            />
          </NuxtLink>
        </div>

        <!--
          Not nested under either group above: neither switch here is a
          reading of one particular sheet any more (see `overlayToggles`) —
          both are plain overlays drawn above whichever basemap is showing.
          A toggle whose own `canShow` is false (only ever the Tabula
          Peutingeriana network, gated on the server's licence flag) is
          skipped rather than shown disabled, matching how the group itself
          used to be hidden outright.
        -->
        <div role="group" :aria-label="t('basemapSwitcher.groupOverlays')">
          <p
            class="eyebrow border-b border-paper-200 px-4 pb-1 pt-3 text-ink-500 dark:border-night-700 dark:text-paper-400"
          >
            {{ t('basemapSwitcher.groupOverlays') }}
          </p>

          <template v-for="entry in overlayToggles" :key="entry.key">
            <button
              v-if="entry.canShow"
              type="button"
              role="menuitemcheckbox"
              :aria-checked="entry.isActive"
              class="flex w-full items-center gap-3 border-b border-paper-200 px-4 py-3 text-left transition last:border-b-0 hover:bg-paper-200 dark:border-night-700 dark:hover:bg-night-700"
              @click="entry.toggle"
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
      </div>
    </Transition>
  </div>
</template>
