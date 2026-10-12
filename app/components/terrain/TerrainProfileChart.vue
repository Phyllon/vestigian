<script setup lang="ts">
  /**
   * Ground against distance, as one SVG — no chart library, because this is the
   * only chart in the app and it is a polyline with two axes. If a second chart
   * appears, that is the day to adopt one (uPlot is the candidate: MIT, ~40 KB).
   *
   * It is a picture of numbers that are also written out beside it, so the SVG is
   * one `role="img"` with a summary, and the only interactive part is a native
   * range input laid over it: arrow keys step along the line, a finger drags
   * along it, and a screen reader reads the value text. A native control is what
   * makes this keyboard-operable without a custom widget.
   */
  const props = defineProps<{
    distances: number[]
    elevations: number[]
    /** A second line on the same scale — the line of sight between two towers. */
    sight?: number[]
    /** Sample indexes at which a separate part of the line begins. */
    breaks?: number[]
    summary: string
    scrubLabel: string
    /** The sight line's own name, for the readout and the key. */
    sightLabel?: string
  }>()

  const emit = defineEmits<{ scrub: [index: number | null] }>()

  const { t } = useI18n()
  const { distance, metres, gradient } = useTerrainFormat()

  const WIDTH = 320
  const HEIGHT = 150
  const MARGIN = { left: 40, right: 8, top: 10, bottom: 24 }
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  const sampleCount = computed(() => props.distances.length)
  const totalDistance = computed(() => props.distances[props.distances.length - 1] ?? 0)

  /**
   * A near-flat line is not drawn as a mountain range: the scale is never finer
   * than ten metres top to bottom, or two metres of noise reads as a cliff.
   */
  const range = computed(() => {
    const values = [...props.elevations, ...(props.sight ?? [])]
    const lowest = Math.min(...values)
    const highest = Math.max(...values)
    const span = Math.max(highest - lowest, 10)
    const padding = span * 0.08
    const middle = (highest + lowest) / 2
    return { low: middle - span / 2 - padding, high: middle + span / 2 + padding }
  })

  const toX = (distanceMetres: number): number =>
    MARGIN.left + (totalDistance.value > 0 ? (distanceMetres / totalDistance.value) * plotWidth : 0)

  const toY = (elevation: number): number =>
    MARGIN.top +
    plotHeight -
    ((elevation - range.value.low) / (range.value.high - range.value.low)) * plotHeight

  const round = (value: number): string => String(Math.round(value * 10) / 10)

  /** One `M … L …` run per part, so a gap between two traces is not drawn across. */
  const pathFor = (values: number[]): string => {
    const starts = new Set(props.breaks ?? [])
    return values
      .map((value, index) => {
        const command = index === 0 || starts.has(index) ? 'M' : 'L'
        return `${command}${round(toX(props.distances[index]!))} ${round(toY(value))}`
      })
      .join(' ')
  }

  const linePath = computed(() => pathFor(props.elevations))
  const sightPath = computed(() => (props.sight ? pathFor(props.sight) : ''))

  const areaPath = computed(() => {
    if (props.elevations.length === 0) return ''
    const baseline = round(MARGIN.top + plotHeight)
    const first = round(toX(props.distances[0]!))
    const last = round(toX(totalDistance.value))
    return `${linePath.value} L${last} ${baseline} L${first} ${baseline} Z`
  })

  // Labelled at the data's own extremes, not the padded scale: a line that bottoms
  // out at 12 m must not be captioned "-11 m", which reads as below the sea.
  const extremes = computed(() => {
    const values = [...props.elevations, ...(props.sight ?? [])]
    return { low: Math.min(...values), high: Math.max(...values) }
  })
  const lowLabel = computed(() => metres(Math.round(extremes.value.low), 0))
  const highLabel = computed(() => metres(Math.round(extremes.value.high), 0))

  const index = ref<number | null>(null)

  const cursor = computed(() => {
    const current = index.value
    if (current === null) return null
    return {
      x: toX(props.distances[current]!),
      y: toY(props.elevations[current]!),
      sightY: props.sight ? toY(props.sight[current]!) : null,
    }
  })

  /** The slope across the sample either side of the cursor. */
  const localGradient = (current: number): number => {
    const before = Math.max(current - 1, 0)
    const after = Math.min(current + 1, props.distances.length - 1)
    const run = props.distances[after]! - props.distances[before]!
    return run > 0 ? ((props.elevations[after]! - props.elevations[before]!) / run) * 100 : 0
  }

  const readout = computed(() => {
    const current = index.value
    if (current === null) return ''
    if (props.sight) {
      return t('elevationProfile.readoutSight', {
        distance: distance(props.distances[current]!),
        ground: metres(props.elevations[current]!),
        sight: metres(props.sight[current]!),
        sightLabel: props.sightLabel ?? '',
      })
    }
    return t('elevationProfile.readout', {
      distance: distance(props.distances[current]!),
      elevation: metres(props.elevations[current]!),
      gradient: gradient(localGradient(current)),
    })
  })

  const handleInput = (event: Event): void => {
    const value = Number((event.target as HTMLInputElement).value)
    index.value = value
    emit('scrub', value)
  }

  const release = (): void => {
    index.value = null
    emit('scrub', null)
  }

  onBeforeUnmount(() => emit('scrub', null))
</script>

<template>
  <figure class="m-0">
    <div
      class="relative rounded-notebook focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-oxide-600"
    >
      <svg
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        class="block h-auto w-full"
        role="img"
        :aria-label="summary"
      >
        <path :d="areaPath" class="fill-paper-200 dark:fill-night-700" />
        <path
          :d="linePath"
          fill="none"
          class="stroke-ink-700 dark:stroke-paper-200"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
        <path
          v-if="sightPath"
          :d="sightPath"
          fill="none"
          class="stroke-[#9a5b06] dark:stroke-[#f0b94d]"
          stroke-width="1.6"
          stroke-dasharray="5 3"
        />

        <g class="fill-ink-500 font-mono text-[9px] dark:fill-paper-400">
          <text :x="MARGIN.left - 4" :y="toY(extremes.high) + 3" text-anchor="end">
            {{ highLabel }}
          </text>
          <text :x="MARGIN.left - 4" :y="toY(extremes.low) + 3" text-anchor="end">
            {{ lowLabel }}
          </text>
          <text :x="MARGIN.left" :y="HEIGHT - 6" text-anchor="start">0</text>
          <text :x="MARGIN.left + plotWidth" :y="HEIGHT - 6" text-anchor="end">
            {{ distance(totalDistance) }}
          </text>
        </g>

        <g v-if="cursor" aria-hidden="true">
          <line
            :x1="cursor.x"
            :x2="cursor.x"
            :y1="MARGIN.top"
            :y2="MARGIN.top + plotHeight"
            class="stroke-oxide-600 dark:stroke-oxide-300"
            stroke-width="1"
          />
          <circle
            :cx="cursor.x"
            :cy="cursor.y"
            r="3.5"
            class="fill-oxide-600 dark:fill-oxide-300"
          />
          <circle
            v-if="cursor.sightY !== null"
            :cx="cursor.x"
            :cy="cursor.sightY"
            r="3"
            class="fill-[#9a5b06] dark:fill-[#f0b94d]"
          />
        </g>
      </svg>

      <input
        v-if="sampleCount > 1"
        type="range"
        min="0"
        :max="sampleCount - 1"
        step="1"
        :value="index ?? 0"
        :aria-label="scrubLabel"
        :aria-valuetext="readout || undefined"
        class="absolute inset-0 h-full w-full cursor-crosshair touch-pan-y opacity-0"
        @input="handleInput"
        @blur="release"
      />
    </div>

    <figcaption class="mt-1 min-h-5 font-mono text-xs text-ink-500 dark:text-paper-400">
      <span v-if="readout">{{ readout }}</span>
      <span v-else>{{ scrubLabel }}</span>
    </figcaption>
  </figure>
</template>
