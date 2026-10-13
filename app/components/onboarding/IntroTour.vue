<script setup lang="ts">
  import { useElementBounding, useEventListener, useMediaQuery } from '@vueuse/core'

  /**
   * The introduction itself: a dimmed screen, one lit-up control, and a card
   * that points at it. Mounted (lazily, by `pages/index.vue`) only while it is
   * open, so a returning visitor downloads none of it. Who sees it and what is
   * stored: `useIntroTour.ts`.
   *
   * **How the dimming works.** The "spotlight" is a transparent box laid over
   * the control with a 9999px box-shadow around it — the shadow is the dark
   * sheet, the box is the hole in it. No clip-path to recompute, and the
   * control underneath stays pixel-exact in whatever theme it is in. The same
   * box is the popover's anchor, so Reka UI's floating-ui does the positioning,
   * collision-flipping and arrow rather than anything hand-written here.
   *
   * **Why the page behind is `inert`.** While the tour is up the rest of the app
   * must be neither clickable, tabbable nor read by a screen reader: the lit
   * control is a picture of the button, not the button. `inert` on the app root
   * does all three at once, and is why this component teleports to `body` —
   * left inside `#__nuxt`, it would be inert too. Focus returns to wherever it
   * was when the tour opens.
   */
  interface CardHandle {
    focusPrimary: () => void
  }

  const SPOTLIGHT_PADDING = 6
  const APP_ROOT_ID = '__nuxt'
  const ATTRIBUTION_SELECTOR = '.maplibregl-ctrl-attrib'
  const ATTRIBUTION_EXPANDED_CLASS = 'maplibregl-compact-show'

  const { t } = useI18n()
  const { close } = useIntroTour()
  const map = useMapInstance()
  const isWide = useMediaQuery('(min-width: 640px)')

  const titleId = useId()
  const bodyId = useId()

  const steps = ref<IntroStep[]>([])
  const stepIndex = ref(0)
  const targetElement = shallowRef<HTMLElement | null>(null)
  const welcomeCard = useTemplateRef<CardHandle>('welcomeCard')
  const targetCard = useTemplateRef<CardHandle>('targetCard')

  const currentStep = computed(() => steps.value[stepIndex.value])
  const isFirst = computed(() => stepIndex.value === 0)
  const isLast = computed(() => stepIndex.value === steps.value.length - 1)

  const { top, left, width, height, update } = useElementBounding(targetElement)

  const spotlightStyle = computed(() => ({
    top: `${top.value - SPOTLIGHT_PADDING}px`,
    left: `${left.value - SPOTLIGHT_PADDING}px`,
    width: `${width.value + SPOTLIGHT_PADDING * 2}px`,
    height: `${height.value + SPOTLIGHT_PADDING * 2}px`,
  }))

  const currentTitle = computed(() =>
    currentStep.value ? t(`introTour.steps.${currentStep.value.id}.title`) : '',
  )

  const popoverContent = computed(() => ({
    side: resolveIntroSide(currentStep.value?.side, isWide.value),
    sideOffset: 14,
    collisionPadding: 12,
    // The spotlight glides between controls; follow it frame by frame instead
    // of only on resize/scroll, or the card trails behind it mid-move.
    updatePositionStrategy: 'always' as const,
    // Reka sets its own `aria-labelledby` (to a trigger that does not exist
    // here), which wins over one passed in — so the dialog is named directly.
    'aria-label': currentTitle.value,
    'aria-describedby': bodyId,
    // Reka would focus the first button ("Skip"); the way forward is "Next".
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault()
      targetCard.value?.focusPrimary()
    },
  }))

  const announcement = computed(() => {
    const step = currentStep.value
    if (!step) return ''
    const progress = t('introTour.progress', {
      current: stepIndex.value + 1,
      total: steps.value.length,
    })
    return `${progress}: ${currentTitle.value}`
  })

  const findTarget = (target: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-tour="${target}"]`)

  const isTargetOnScreen = (target: string): boolean => {
    const rect = findTarget(target)?.getBoundingClientRect()
    return rect !== undefined && rect.width > 0 && rect.height > 0
  }

  const goToNext = (): void => {
    if (isLast.value) {
      close()
      return
    }
    stepIndex.value = clampStepIndex(stepIndex.value + 1, steps.value.length)
  }

  const goToPrevious = (): void => {
    stepIndex.value = clampStepIndex(stepIndex.value - 1, steps.value.length)
  }

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') close()
    if (event.key === 'ArrowRight') goToNext()
    if (event.key === 'ArrowLeft') goToPrevious()
  }

  watch(currentStep, async (step) => {
    targetElement.value = step?.target ? findTarget(step.target) : null
    update()
    // Stepping back to the welcome swaps the popover for a fresh card, and the
    // button that had focus goes with it. (Going forward is covered by the
    // popover's own `onOpenAutoFocus`.)
    if (step && !step.target) {
      await nextTick()
      welcomeCard.value?.focusPrimary()
    }
  })

  useEventListener(window, 'keydown', handleKeydown)

  // The control rows sit in a container whose padding eases back when a panel
  // closes under the tour (`pages/index.vue`), so the controls are still moving
  // when they are first measured. Nothing observes a parent's padding, so
  // re-measure whenever any transition on the page settles.
  useEventListener(document, 'transitionend', update, { passive: true })

  let previouslyFocused: Element | null = null

  const setPageInert = (isInert: boolean): void => {
    const root = document.getElementById(APP_ROOT_ID)
    if (!root) return
    root.toggleAttribute('inert', isInert)
  }

  /**
   * MapLibre owns the credits control, so it gets its `data-tour` attribute here
   * rather than in a template. On a phone it starts expanded (its own
   * `_updateCompact`) and a long list of overlay credits would sit over the
   * corner the step points at; dropping the class is what its own drag-to-
   * minimise does, so the control is left in a state it already knows.
   */
  const prepareAttribution = (): void => {
    const container = map.value?.getContainer()
    const attribution = container?.querySelector<HTMLElement>(ATTRIBUTION_SELECTOR)
    if (!attribution) return
    attribution.classList.remove(ATTRIBUTION_EXPANDED_CLASS)
    attribution.dataset.tour = 'attribution'
  }

  onMounted(() => {
    previouslyFocused = document.activeElement
    prepareAttribution()
    steps.value = resolveIntroSteps(INTRO_STEPS, isTargetOnScreen)
    setPageInert(true)
  })

  onBeforeUnmount(() => {
    setPageInert(false)
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected)
      previouslyFocused.focus()
  })
</script>

<template>
  <Teleport to="body">
    <!--
      Also the click-blocker: it covers the screen, so a tap outside the card
      does nothing rather than reaching the (inert) map beneath.
    -->
    <div v-if="currentStep" class="fixed inset-0 z-[60]">
      <p class="sr-only" role="status">{{ announcement }}</p>

      <template v-if="!currentStep.target">
        <div aria-hidden="true" class="absolute inset-0 bg-ink-950/85" />
        <div class="absolute inset-0 grid place-items-center p-3">
          <section
            role="dialog"
            aria-modal="true"
            :aria-labelledby="titleId"
            :aria-describedby="bodyId"
            class="rounded-[var(--radius-notebook)] border border-paper-300 bg-[var(--surface-raised)] shadow-[var(--shadow-lifted)] dark:border-night-600"
          >
            <OnboardingIntroTourCard
              ref="welcomeCard"
              :step-id="currentStep.id"
              :position="stepIndex + 1"
              :total="steps.length"
              :is-first="isFirst"
              :is-last="isLast"
              :title-id="titleId"
              :body-id="bodyId"
              @next="goToNext"
              @previous="goToPrevious"
              @skip="close"
            />
          </section>
        </div>
      </template>

      <UPopover
        v-else
        open
        :dismissible="false"
        arrow
        :content="popoverContent"
        :ui="{
          content:
            'z-[70] rounded-[var(--radius-notebook)] border border-paper-300 bg-[var(--surface-raised)] shadow-[var(--shadow-lifted)] ring-0 dark:border-night-600',
          arrow: 'fill-[var(--surface-raised)]',
        }"
      >
        <template #anchor>
          <div
            aria-hidden="true"
            class="fixed rounded-[calc(var(--radius-notebook)+4px)] shadow-[0_0_0_9999px_rgb(16_14_12/0.85)] ring-2 ring-paper-50/90 transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
            :style="spotlightStyle"
          />
        </template>

        <template #content>
          <OnboardingIntroTourCard
            ref="targetCard"
            :step-id="currentStep.id"
            :position="stepIndex + 1"
            :total="steps.length"
            :is-first="isFirst"
            :is-last="isLast"
            :title-id="titleId"
            :body-id="bodyId"
            @next="goToNext"
            @previous="goToPrevious"
            @skip="close"
          />
        </template>
      </UPopover>
    </div>
  </Teleport>
</template>
