<script setup lang="ts">
  import { onClickOutside } from '@vueuse/core'

  /**
   * The period scrubber, in its own control — extracted out of
   * `BasemapSwitcher.vue`, the same move `OverlaySwitcher.vue`'s own
   * docstring already describes for the overlay toggles. It stayed behind
   * there originally because the extent it drew was a property of the
   * Barrington sheet specifically; `usePeriodOverlay` now draws it above
   * whichever basemap is showing, the same generalisation the frontier went
   * through first, so there is no reason left to nest it inside a menu named
   * after the sheet.
   *
   * Named "Ancient empires" rather than the generic "Periods" a reader would
   * have to open the panel to understand: the slider moves the Roman state
   * through time, and the switch under it adds the realms it faced (Carthage,
   * Parthia, the Goths) in the same year. That switch lives here, not among
   * the overlays, because it has no meaning without the slider — it is shown
   * only while a date is chosen.
   */
  const { periodYear, setPeriodYear, canShowPolities, isShowingPolities, setPolitiesEnabled } =
    useBasemapStyle()
  const { steps: periodSteps, load: loadPeriodSteps } = useEmpirePeriods()
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
      ? t('periodSwitcher.off')
      : formatPeriodYear(periodYear.value, (key, named) => t(key, named)),
  )

  const triggerLabel = computed<string>(() =>
    t('periodSwitcher.label', { state: periodSliderLabel.value }),
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
  const periodSlider = useTemplateRef<{ $el?: HTMLElement }>('periodSlider')

  /**
   * `watch(..., { flush: 'post' })` rather than `watchEffect`, and the step
   * count is listed as a source explicitly. Both details are the bug.
   *
   * A `watchEffect` ran *before* the DOM was patched, found no thumb, and
   * returned — then never ran again, because the only reactive value it
   * happened to touch afterwards was `periodSliderLabel`, which reads "Off"
   * both before and after the fetched steps arrive. An unchanged computed does
   * not re-trigger an effect, so the thumb was rendered and left permanently
   * unnamed: `getByRole('slider', { name: … })` found nothing, and so would a
   * screen reader. `flush: 'post'` moves the callback after the patch, and
   * naming `periodSteps.length` as a source is what actually fires when the
   * slider stops being `:disabled` and the thumb appears.
   *
   * The ref is a single component instance, not an array. It was written as
   * `periodSlider.value?.[0]?.$el` — array indexing only holds for a ref
   * inside a `v-for`, and there is none here — so the lookup resolved to
   * `undefined` on every run and the early return fired every time. The thumb
   * was therefore never named at all, from the moment this code was written:
   * `getByRole('slider', { name: … })` could not match it, and neither could a
   * screen reader. Verified against the rendered DOM in a real browser rather
   * than reasoned about again — the thumb is present and enabled, and its
   * `aria-label` was simply `null`.
   */
  watch(
    [periodSlider, () => periodSteps.value.length, periodSliderLabel],
    () => {
      const sliderRoot = periodSlider.value?.$el
      const thumb = sliderRoot?.querySelector?.('[role="slider"]')
      if (!thumb) return
      thumb.setAttribute('aria-label', t('periodSwitcher.scrubberLabel'))
      thumb.setAttribute('aria-valuetext', periodSliderLabel.value)
    },
    { flush: 'post', immediate: true },
  )

  onClickOutside(root, close)

  /**
   * The scrubber's stops are fetched, not constant, so they have to arrive
   * before the slider can be dragged — but only for a reader who actually
   * opens this switcher. Watching `isOpen` rather than loading `onMounted`
   * keeps that request off every first paint, the same restraint the extent
   * tiles themselves already follow by staying out of the map until a period
   * is chosen.
   */
  watch(isOpen, (open) => {
    if (open) void loadPeriodSteps()
  })
</script>

<template>
  <!--
    Escape delegate only, not a control of its own: the div is never focusable
    and has no role, it just catches the key while it bubbles up from the
    trigger button or the open panel beneath it.
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
      :aria-label="triggerLabel"
      aria-haspopup="true"
      aria-controls="period-switcher-panel"
      @click="isOpen = !isOpen"
    >
      <UIcon
        name="i-lucide-history"
        class="size-4 text-oxide-600 dark:text-oxide-300"
        aria-hidden="true"
      />
      <span class="hidden sm:inline">{{ t('periodSwitcher.title') }}</span>
    </button>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <fieldset
        v-if="isOpen"
        id="period-switcher-panel"
        :aria-label="t('periodSwitcher.menuLabel')"
        class="leaf absolute right-0 top-full z-20 mt-2 w-72 min-w-0 p-4 shadow-lifted"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <span class="text-sm font-medium text-ink-900 dark:text-paper-100">
            {{ t('periodSwitcher.heading') }}
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
          see `useEmpirePeriods`. `aria-live` because the text changes under
          a slider the reader is already operating by keyboard.
        -->
        <p
          v-if="currentPeriodStep?.endEvent"
          class="mt-2 text-xs leading-snug text-ink-500 dark:text-paper-400"
          aria-live="polite"
        >
          {{ currentPeriodStep.endEvent }}
        </p>
        <!--
          Directly under the slider it belongs to. `USwitch` is Reka UI's
          switch, so the keyboard and screen-reader behaviour is not hand-built.
        -->
        <USwitch
          v-if="canShowPolities"
          :model-value="isShowingPolities"
          :label="t('periodSwitcher.showPolities')"
          :description="t('periodSwitcher.showPolitiesHint')"
          size="sm"
          class="mt-3 border-t border-paper-200 pt-3 dark:border-night-700"
          @update:model-value="setPolitiesEnabled"
        />
        <p class="mt-2 text-xs italic text-ink-400 dark:text-paper-500">
          {{ t('periodSwitcher.approximate') }}
        </p>
      </fieldset>
    </Transition>
  </div>
</template>
