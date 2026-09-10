<script setup lang="ts">
  import { onClickOutside } from '@vueuse/core'
  import type { BasemapGroup, BasemapView } from '#shared/types'

  /**
   * The sheet, and the one control that redraws the sheet itself. Every
   * overlay switch moved out to `OverlaySwitcher.vue`, and the period
   * scrubber moved out to `PeriodSwitcher.vue` for the same reason — see
   * that component's own docstring for why it no longer has to live here.
   */
  const { view, setView, availableViews } = useBasemapStyle()
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
        Capped against the viewport rather than sized to the content: two
        groups of sheets is taller than a phone in landscape, and a menu that
        runs off the bottom of the screen has no way back.
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
        </div>
      </div>
    </Transition>
  </div>
</template>
