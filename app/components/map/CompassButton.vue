<script setup lang="ts">
  import { COMPASS_MOVE_FLAG } from '~/composables/map/useCompassHeading'

  /**
   * "Turn the map the way I am facing" — heading-up, as every navigation app
   * offers while walking. Off by default and shown only on a touch device that
   * can report orientation: a laptop has nothing to turn the map with.
   *
   * The sensor and its filtering are `useCompassHeading`; this only applies the
   * result to the map and says what happened. Rotation is otherwise disabled on
   * this map (`createMapInstance`), so nothing else competes for the bearing.
   * Switching off puts north back on top, which is the only way back to a map
   * that reads the way the notebook's printed sheets do.
   */
  const EASE_DURATION_MS = 200
  const RESET_DURATION_MS = 300

  const { t } = useI18n()
  const map = useMapInstance()
  const { status, heading, isSupported, refreshSupport, start, stop } = useCompassHeading()

  const bearing = ref(0)

  const isActive = computed(() => status.value === 'active')
  const isBusy = computed(() => status.value === 'requesting')

  const buttonLabel = computed(() =>
    isActive.value || isBusy.value ? t('compass.turnOff') : t('compass.turnOn'),
  )

  const message = computed(() => {
    if (status.value === 'denied') return t('compass.denied')
    if (status.value === 'unavailable') return t('compass.unavailable')
    return null
  })

  const toggle = async (): Promise<void> => {
    if (isActive.value || isBusy.value) {
      stop()
      map.value?.easeTo({ bearing: 0, duration: RESET_DURATION_MS }, { [COMPASS_MOVE_FLAG]: true })
      return
    }
    await start()
  }

  watch(heading, (next) => {
    if (next === null || !map.value) return
    // Linear: each reading arrives while the last ease is still running, and an
    // eased start-and-stop curve would pulse the map between them.
    map.value.easeTo(
      { bearing: next, duration: EASE_DURATION_MS, easing: (progress) => progress },
      { [COMPASS_MOVE_FLAG]: true },
    )
  })

  /** Where north is on screen, for the arrow — read from the map, not from the sensor. */
  watch(
    map,
    (instance, _previous, onCleanup) => {
      if (!instance) return
      const readBearing = (): void => {
        bearing.value = instance.getBearing()
      }
      instance.on('rotate', readBearing)
      onCleanup(() => instance.off('rotate', readBearing))
    },
    { immediate: true },
  )

  onMounted(() => {
    refreshSupport()
  })
</script>

<template>
  <div v-if="isSupported" class="flex flex-col items-end gap-2">
    <button
      type="button"
      class="leaf grid size-11 place-items-center transition hover:bg-paper-200 dark:hover:bg-night-700"
      :class="
        isActive ? 'text-verdigris-600 dark:text-verdigris-400' : 'text-ink-700 dark:text-paper-200'
      "
      :aria-pressed="isActive"
      data-tour="compass"
      :aria-label="buttonLabel"
      :title="buttonLabel"
      @click="toggle"
    >
      <!-- While turning, the arrow is the map's north, so the reader can see which way it went. -->
      <UIcon
        v-if="isActive"
        name="i-lucide-navigation-2"
        class="size-5"
        :style="{ transform: `rotate(${-bearing}deg)` }"
      />
      <UIcon v-else name="i-lucide-compass" class="size-5" :class="isBusy ? 'animate-pulse' : ''" />
    </button>

    <p
      v-if="message"
      class="leaf max-w-56 px-3 py-2 text-xs text-ink-500 dark:text-paper-400"
      role="status"
    >
      {{ message }}
    </p>
  </div>
</template>
