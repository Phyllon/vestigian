<script setup lang="ts">
  /**
   * The text of one step and its three navigation buttons. Presentational on
   * purpose: `IntroTour.vue` puts the same card in two places — centred for the
   * welcome, inside a popover pointing at a control for every other step — and
   * everything about *where* it sits belongs there, not here.
   *
   * "Next" is the one oxide-red element on the screen the tour is showing.
   */
  interface Props {
    stepId: string
    /** 1-based, counting only the steps that are actually shown. */
    position: number
    total: number
    isFirst: boolean
    isLast: boolean
    titleId: string
    bodyId: string
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{ next: []; previous: []; skip: [] }>()

  const { t, te } = useI18n()

  const hasTry = computed(() => te(`introTour.steps.${props.stepId}.try`))

  const progressLabel = computed(() =>
    props.isFirst
      ? t('introTour.eyebrowWelcome')
      : t('introTour.progress', { current: props.position, total: props.total }),
  )

  const primaryLabel = computed(() => {
    if (props.isFirst) return t('introTour.start')
    if (props.isLast) return t('introTour.finish')
    return t('introTour.next')
  })

  const card = useTemplateRef<HTMLElement>('card')

  /**
   * Keyboard and screen-reader users land on the way forward, not on "Skip".
   * Found by attribute, not through a ref to the button: a component ref's
   * `$el` is not guaranteed to be the `<button>` itself, and `.focus` on
   * anything else throws.
   */
  const focusPrimary = (): void => {
    card.value?.querySelector<HTMLButtonElement>('[data-intro-primary]')?.focus()
  }

  defineExpose({ focusPrimary })
</script>

<template>
  <div
    ref="card"
    class="max-h-[min(70dvh,32rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto p-4"
  >
    <p class="eyebrow">{{ progressLabel }}</p>

    <h2
      :id="titleId"
      class="mt-1 font-display text-lg leading-snug text-ink-900 dark:text-paper-100"
    >
      {{ t(`introTour.steps.${stepId}.title`) }}
    </h2>

    <div
      :id="bodyId"
      class="mt-2 space-y-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200"
    >
      <p>{{ t(`introTour.steps.${stepId}.body`) }}</p>
      <p v-if="hasTry">
        <span class="font-medium text-ink-900 dark:text-paper-100">{{ t('introTour.try') }}</span>
        {{ t(`introTour.steps.${stepId}.try`) }}
      </p>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
      <UButton
        v-if="!isLast"
        variant="ghost"
        color="neutral"
        size="sm"
        class="min-h-10"
        @click="emit('skip')"
      >
        {{ t('introTour.skip') }}
      </UButton>

      <div class="ml-auto flex gap-2">
        <UButton
          v-if="!isFirst"
          variant="outline"
          color="neutral"
          icon="i-lucide-arrow-left"
          class="min-h-10"
          @click="emit('previous')"
        >
          {{ t('introTour.previous') }}
        </UButton>
        <UButton
          data-intro-primary
          color="primary"
          trailing-icon="i-lucide-arrow-right"
          class="min-h-10"
          @click="emit('next')"
        >
          {{ primaryLabel }}
        </UButton>
      </div>
    </div>
  </div>
</template>
