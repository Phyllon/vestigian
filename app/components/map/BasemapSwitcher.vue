<script setup lang="ts">
  import { onClickOutside } from '@vueuse/core'
  import type { BasemapGroup, BasemapView } from '#shared/types'

  /**
   * The sheet, and the one control that redraws the sheet itself. Every
   * overlay switch moved out to `OverlaySwitcher.vue` — see its docstring for
   * why, and for why the scrubber below did not go with them.
   */
  const { view, setView, availableViews, canShowPeriodExtent, periodYear, setPeriodYear } =
    useBasemapStyle()
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

  const { steps: periodSteps, load: loadPeriodSteps } = useEmpirePeriods()

  /**
   * An index domain, not the year itself — `USlider` moves its thumb by even
   * steps, and the gaps in this series run from a single year (116 to 117)
   * to 171 (509 to 338 BCE). Mapping the thumb to the year would compress
   * the entire early Republic into a few pixels. Position 0 is the
   * scrubber's own "off" state, so a fresh visitor sees nothing extra on the
   * sheet until they actually drag it.
   */
  const periodSliderIndex = computed<number>({
    get: () => {
      if (periodYear.value === null) return 0
      const index = periodSteps.value.findIndex((step) => step.year === periodYear.value)
      return index === -1 ? 0 : index + 1
    },
    set: (index) => {
      setPeriodYear(index <= 0 ? null : (periodSteps.value[index - 1]?.year ?? null))
    },
  })

  const currentPeriodStep = computed(() =>
    periodYear.value === null
      ? null
      : (periodSteps.value.find((step) => step.year === periodYear.value) ?? null),
  )

  const periodSliderLabel = computed<string>(() =>
    periodYear.value === null
      ? t('basemapSwitcher.periodOff')
      : formatPeriodYear(periodYear.value, (key, named) => t(key, named)),
  )

  /**
   * Nuxt UI's `<USlider>` forwards `aria-*` attrs only to `SliderRoot` — the
   * wrapping element — never to `SliderThumb`, which is the actual element
   * carrying `role="slider"` (confirmed by reading both components' source,
   * not assumed). A screen reader names a slider from *that* element, so an
   * `aria-label` passed as a normal prop is silently inert: it lands on a
   * `<span>` nothing asks for a name. Setting it directly on the thumb once
   * it exists, and keeping it in sync as the label changes, is the smallest
   * fix that doesn't mean dropping an established component for a hand-rolled
   * `<input type="range">` over one missing attribute passthrough.
   */
  /**
   * `useTemplateRef`'s own type only ever models a single instance, but the
   * `ref` here sits inside the `v-for="group in groups"` block above
   * (guarded by its own `v-if`, so it renders once) — Vue still collects
   * refs inside a `v-for` scope into an array at runtime regardless of how
   * many iterations actually render the element, which the composable's
   * type signature does not account for. Confirmed by logging the raw
   * value during development, not assumed from the type alone.
   */
  const periodSlider = useTemplateRef<{ $el?: HTMLElement }[]>('periodSlider')

  watchEffect(() => {
    const root = periodSlider.value?.[0]?.$el
    const thumb = root?.querySelector?.('[role="slider"]')
    if (!thumb) return
    thumb.setAttribute('aria-label', t('basemapSwitcher.periodScrubber'))
    thumb.setAttribute('aria-valuetext', periodSliderLabel.value)
  })

  const activeLabel = computed(
    () => availableViews.find((option) => option.value === view.value)?.label ?? 'Vestigian',
  )

  onClickOutside(root, close)

  /**
   * The scrubber's stops are fetched, not constant, so they have to arrive
   * before the slider can be dragged — but only for a reader who actually
   * opens the switcher on the sheet that has a scrubber. Watching both
   * conditions rather than loading `onMounted` keeps that request off every
   * first paint, the same restraint the extent tiles themselves already
   * follow by staying out of the style until a period is chosen.
   */
  watch(
    () => isOpen.value && canShowPeriodExtent.value,
    (shouldLoad) => {
      if (shouldLoad) void loadPeriodSteps()
    },
    { immediate: true },
  )
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
        groups of sheets plus the period scrubber is taller than a phone in
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
            Only while the Barrington sheet is the active view — the three
            dates it draws are a property of that sheet's own data, not a
            reading that makes sense laid over DARE or a modern basemap.
          -->
          <div
            v-if="group === 'antiquity' && canShowPeriodExtent"
            class="border-b border-paper-200 px-4 py-3 dark:border-night-700"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-sm font-medium text-ink-900 dark:text-paper-100">
                {{ t('basemapSwitcher.periodScrubber') }}
              </span>
              <span class="font-mono text-xs text-ink-500 dark:text-paper-400">
                {{ periodSliderLabel }}
              </span>
            </div>
            <USlider
              ref="periodSlider"
              v-model="periodSliderIndex"
              :min="0"
              :max="periodSteps.length"
              :step="1"
              size="sm"
              :disabled="periodSteps.length === 0"
            />
            <!--
              What the source itself says ends this slice ("Trajan conquers
              Armenia"). English only upstream and deliberately untranslated —
              see `useEmpirePeriods`. `aria-live` because the text changes
              under a slider the reader is already operating by keyboard.
            -->
            <p
              v-if="currentPeriodStep?.endEvent"
              class="mt-2 text-xs leading-snug text-ink-500 dark:text-paper-400"
              aria-live="polite"
            >
              {{ currentPeriodStep.endEvent }}
            </p>
            <p class="mt-2 text-xs italic text-ink-400 dark:text-paper-500">
              {{ t('basemapSwitcher.periodApproximate') }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
