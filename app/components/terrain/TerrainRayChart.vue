<script setup lang="ts">
  import type { TowerRaySection } from '#shared/types'

  /**
   * One compass line out from a tower, drawn the way it is explained: the ground
   * as a section, the sentry's eyes at the left, the line of sight that just
   * clears the crest, the stretches that line leaves hidden shaded, and the two
   * places that matter — the crest and where ground returns — marked with their
   * heights. One `role="img"` with a summary; a native range input over it steps
   * along the line for keyboard, finger and screen reader alike.
   *
   * Hand-drawn SVG for the reason `TerrainProfileChart` is: it is a polyline with
   * two axes. The grazing line is the geometry of the calculation itself (the
   * steepest angle to the crest), so it is drawn from the same two numbers.
   */
  const props = defineProps<{
    ray: TowerRaySection
    /** How far out the section is drawn; the data may run further. */
    xMaxMetres: number
    summary: string
    scrubLabel: string
    crestLabel: string
    againLabel: string
  }>()

  const emit = defineEmits<{ scrub: [index: number | null] }>()

  const { t } = useI18n()
  const { distance, metres } = useTerrainFormat()

  const WIDTH = 320
  const HEIGHT = 190
  const MARGIN = { left: 42, right: 12, top: 14, bottom: 40 }
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const baseline = MARGIN.top + plotHeight

  /** Samples inside the drawn distance. */
  const count = computed(() => {
    let last = 0
    props.ray.distances.forEach((value, index) => {
      if (value <= props.xMaxMetres) last = index + 1
    })
    return Math.max(last, 2)
  })

  const distances = computed(() => props.ray.distances.slice(0, count.value))
  const ground = computed(() => props.ray.ground.slice(0, count.value))
  const xMax = computed(() =>
    Math.min(props.xMaxMetres, distances.value[distances.value.length - 1] ?? 1),
  )

  /** The section's vertical scale: ground, eye, and a little air. Never finer than 12 m. */
  const range = computed(() => {
    const values = [...ground.value, props.ray.eyeElevationMetres, props.ray.groundElevationMetres]
    const lowest = Math.min(...values)
    const highest = Math.max(...values)
    const span = Math.max(highest - lowest, 12)
    const pad = span * 0.1
    const middle = (highest + lowest) / 2
    return { low: middle - span / 2 - pad, high: middle + span / 2 + pad }
  })

  const toX = (metresOut: number): number => MARGIN.left + (metresOut / xMax.value) * plotWidth
  const toY = (elevation: number): number =>
    baseline - ((elevation - range.value.low) / (range.value.high - range.value.low)) * plotHeight

  const round = (value: number): string => String(Math.round(value * 10) / 10)

  const groundPath = computed(() =>
    ground.value
      .map(
        (value, index) =>
          `${index === 0 ? 'M' : 'L'}${round(toX(distances.value[index]!))} ${round(toY(value))}`,
      )
      .join(' '),
  )

  const areaPath = computed(
    () =>
      `${groundPath.value} L${round(toX(distances.value[distances.value.length - 1]!))} ${round(baseline)} L${round(toX(distances.value[0]!))} ${round(baseline)} Z`,
  )

  /**
   * The line of sight that just clears the crest: from the eyes through the crest
   * and on. Where the ground stays under it the ground is seen (the target is a
   * standing person, so a little below it is still in view); where it falls away
   * below, the ground is in the crest's shadow. Drawn only where it is on the page.
   */
  const grazing = computed(() => {
    const crest = props.ray.deadGround?.crest ?? props.ray.firstBlock
    if (!crest || crest.atMetres <= 0) return null
    const slope = (crest.groundMetres - props.ray.eyeElevationMetres) / crest.atMetres
    const start = { x: 0, y: props.ray.eyeElevationMetres }
    const end = { x: xMax.value, y: props.ray.eyeElevationMetres + slope * xMax.value }
    // Clip to the plotted vertical range so a steep line does not run off the page.
    const clipTo = (point: { x: number; y: number }): { x: number; y: number } => {
      if (point.y >= range.value.low && point.y <= range.value.high) return point
      const limit = point.y < range.value.low ? range.value.low : range.value.high
      const along = (limit - start.y) / (point.y - start.y)
      return { x: start.x + (point.x - start.x) * along, y: limit }
    }
    const clipped = clipTo(end)
    return {
      x1: toX(start.x),
      y1: toY(start.y),
      x2: toX(clipped.x),
      y2: toY(clipped.y),
    }
  })

  const hiddenRects = computed(() =>
    props.ray.segments
      .filter((segment) => !segment.isSeen && segment.fromMetres < xMax.value)
      .map((segment) => ({
        x: toX(segment.fromMetres),
        width: toX(Math.min(segment.toMetres, xMax.value)) - toX(segment.fromMetres),
      })),
  )

  const seenBands = computed(() =>
    props.ray.segments
      .filter((segment) => segment.isSeen && segment.fromMetres < xMax.value)
      .map((segment) => ({
        x: toX(segment.fromMetres),
        width: Math.max(1, toX(Math.min(segment.toMetres, xMax.value)) - toX(segment.fromMetres)),
      })),
  )

  interface Marker {
    key: string
    x: number
    y: number
    /** One line: how far out, and how high against the foot of the tower. */
    text: string
    /** Raised above a neighbour that would otherwise sit on it. */
    lift: number
    /** `start` near the left axis, where a centred label would sit on the axis figures. */
    anchor: 'start' | 'middle'
    textX: number
    tone: 'crest' | 'again'
  }

  const signed = (value: number): string => {
    let sign = ''
    if (value > 0) sign = '+'
    if (value < 0) sign = '−'
    return `${sign}${metres(Math.abs(value), 1)}`
  }

  const markers = computed((): Marker[] => {
    const wanted: {
      key: string
      at: number
      ground: number
      rise: number
      tone: Marker['tone']
    }[] = []
    const first = props.ray.firstBlock
    const dead = props.ray.deadGround
    if (first) {
      wanted.push({
        key: 'first',
        at: first.atMetres,
        ground: first.groundMetres,
        rise: first.aboveTowerGroundMetres,
        tone: 'crest',
      })
    }
    // The main shadow's crest, when it is not the crest the view first ends at.
    if (dead && dead.crest.atMetres !== first?.atMetres) {
      wanted.push({
        key: 'crest',
        at: dead.crest.atMetres,
        ground: dead.crest.groundMetres,
        rise: dead.crest.aboveTowerGroundMetres,
        tone: 'crest',
      })
    }
    if (dead?.reappearsAt) {
      wanted.push({
        key: 'again',
        at: dead.reappearsAt.atMetres,
        ground: dead.reappearsAt.groundMetres,
        rise: dead.reappearsAt.aboveTowerGroundMetres,
        tone: 'again',
      })
    }

    let previousX = Number.NEGATIVE_INFINITY
    let previousLift = 0
    return wanted
      .filter((marker) => marker.at <= xMax.value)
      .sort((first, second) => first.at - second.at)
      .map((marker) => {
        const x = toX(marker.at)
        // Two labels closer than a label's width would sit on each other: raise the second.
        const lift = x - previousX < 58 ? previousLift + 11 : 0
        previousX = x
        previousLift = lift
        const isNearAxis = x < MARGIN.left + 44
        return {
          key: marker.key,
          x,
          y: toY(marker.ground),
          text: `${distance(marker.at)} · ${signed(marker.rise)}`,
          lift,
          anchor: isNearAxis ? ('start' as const) : ('middle' as const),
          textX: isNearAxis ? x + 5 : x,
          tone: marker.tone,
        }
      })
  })

  const index = ref<number | null>(null)

  const cursor = computed(() => {
    const current = index.value
    if (current === null) return null
    return { x: toX(distances.value[current]!), y: toY(ground.value[current]!) }
  })

  const isSeenAt = (current: number): boolean => {
    const at = distances.value[current]!
    return props.ray.segments.some(
      (segment) => segment.isSeen && at > segment.fromMetres && at <= segment.toMetres,
    )
  }

  const readout = computed(() => {
    const current = index.value
    if (current === null) return ''
    const rise = ground.value[current]! - props.ray.groundElevationMetres
    return t('sightlines.why.readout', {
      distance: distance(distances.value[current]!),
      ground: metres(ground.value[current]!),
      rise: signed(Math.round(rise * 10) / 10),
      state: isSeenAt(current) ? t('sightlines.why.stateSeen') : t('sightlines.why.stateHidden'),
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

  /** A tick spacing that leaves between three and six labels on the axis. */
  const tickStep = (span: number): number => {
    if (span <= 1_500) return 250
    if (span <= 3_000) return 500
    if (span <= 6_000) return 1_000
    return 2_000
  }

  const axisTicks = computed(() => {
    const step = tickStep(xMax.value)
    const ticks: number[] = []
    for (let at = step; at < xMax.value - step / 3; at += step) ticks.push(at)
    return ticks
  })

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
        <!-- Dead ground: the stretches the line over the crest leaves hidden. -->
        <rect
          v-for="(rect, rectIndex) in hiddenRects"
          :key="`hidden-${rectIndex}`"
          :x="rect.x"
          :y="MARGIN.top"
          :width="rect.width"
          :height="plotHeight"
          class="fill-ink-500/10 dark:fill-paper-400/10"
        />

        <path :d="areaPath" class="fill-paper-200 dark:fill-night-700" />
        <path
          :d="groundPath"
          fill="none"
          class="stroke-ink-700 dark:stroke-paper-200"
          stroke-width="1.6"
          stroke-linejoin="round"
        />

        <line
          v-if="grazing"
          :x1="grazing.x1"
          :y1="grazing.y1"
          :x2="grazing.x2"
          :y2="grazing.y2"
          class="stroke-[#9a5b06] dark:stroke-[#f0b94d]"
          stroke-width="1.4"
          stroke-dasharray="5 3"
        />

        <!-- The tower: its feet on the ground, the sentry's eyes at the top. -->
        <line
          :x1="toX(0)"
          :x2="toX(0)"
          :y1="toY(ray.groundElevationMetres)"
          :y2="toY(ray.eyeElevationMetres)"
          class="stroke-[#9a5b06] dark:stroke-[#f0b94d]"
          stroke-width="4"
          stroke-linecap="round"
        />
        <circle
          :cx="toX(0)"
          :cy="toY(ray.eyeElevationMetres)"
          r="3.4"
          class="fill-paper-50 stroke-[#9a5b06] dark:fill-night-800 dark:stroke-[#f0b94d]"
          stroke-width="1.6"
        />

        <!-- The seen stretches, as a band under the section. -->
        <g aria-hidden="true">
          <rect
            :x="MARGIN.left"
            :y="baseline + 4"
            :width="plotWidth"
            height="5"
            class="fill-paper-300 dark:fill-night-600"
          />
          <rect
            v-for="(band, bandIndex) in seenBands"
            :key="`seen-${bandIndex}`"
            :x="band.x"
            :y="baseline + 4"
            :width="band.width"
            height="5"
            class="fill-[#d98a1c] dark:fill-[#f0b94d]"
          />
        </g>

        <g v-for="marker in markers" :key="marker.key" aria-hidden="true">
          <line
            :x1="marker.x"
            :x2="marker.x"
            :y1="marker.y"
            :y2="baseline + 4"
            class="stroke-ink-500 dark:stroke-paper-400"
            stroke-width="0.8"
            stroke-dasharray="2 2"
          />
          <circle
            :cx="marker.x"
            :cy="marker.y"
            r="3.6"
            :class="
              marker.tone === 'crest'
                ? 'fill-oxide-600 dark:fill-oxide-300'
                : 'fill-ink-900 dark:fill-paper-100'
            "
          />
          <text
            :x="marker.textX"
            :y="marker.y - 7 - marker.lift"
            :text-anchor="marker.anchor"
            class="fill-ink-900 stroke-paper-50 font-mono text-[9px] [paint-order:stroke] dark:fill-paper-100 dark:stroke-night-800"
            stroke-width="2.5"
          >
            {{ marker.text }}
          </text>
        </g>

        <g class="fill-ink-500 font-mono text-[9px] dark:fill-paper-400" aria-hidden="true">
          <text :x="MARGIN.left - 4" :y="toY(ray.eyeElevationMetres) + 3" text-anchor="end">
            {{ metres(ray.eyeElevationMetres) }}
          </text>
          <text
            :x="MARGIN.left - 4"
            :y="Math.min(toY(ray.groundElevationMetres) + 3, baseline)"
            text-anchor="end"
            :class="
              Math.abs(toY(ray.groundElevationMetres) - toY(ray.eyeElevationMetres)) < 11
                ? 'hidden'
                : ''
            "
          >
            {{ metres(ray.groundElevationMetres) }}
          </text>
          <text :x="MARGIN.left" :y="HEIGHT - 4" text-anchor="start">0</text>
          <text
            v-for="tick in axisTicks"
            :key="tick"
            :x="toX(tick)"
            :y="HEIGHT - 4"
            text-anchor="middle"
          >
            {{ distance(tick) }}
          </text>
          <text :x="MARGIN.left + plotWidth" :y="HEIGHT - 4" text-anchor="end">
            {{ distance(xMax) }}
          </text>
        </g>

        <g v-if="cursor" aria-hidden="true">
          <line
            :x1="cursor.x"
            :x2="cursor.x"
            :y1="MARGIN.top"
            :y2="baseline"
            class="stroke-oxide-600 dark:stroke-oxide-300"
            stroke-width="1"
          />
          <circle
            :cx="cursor.x"
            :cy="cursor.y"
            r="3.5"
            class="fill-oxide-600 dark:fill-oxide-300"
          />
        </g>
      </svg>

      <input
        type="range"
        min="0"
        :max="count - 1"
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
    <p class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-500 dark:text-paper-400">
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-1.5 w-4 rounded-full bg-[#d98a1c] dark:bg-[#f0b94d]" />
        {{ t('sightlines.why.keySeen') }}
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-4 bg-ink-500/10 dark:bg-paper-400/10" />
        {{ t('sightlines.why.keyHidden') }}
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block size-2 rounded-full bg-oxide-600 dark:bg-oxide-300" />
        {{ crestLabel }}
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block size-2 rounded-full bg-ink-900 dark:bg-paper-100" />
        {{ againLabel }}
      </span>
      <span class="inline-flex items-center gap-1">
        <span
          class="inline-block h-1 w-4 border-t-2 border-dashed border-[#9a5b06] dark:border-[#f0b94d]"
        />
        {{ t('sightlines.why.keyLine') }}
      </span>
    </p>
  </figure>
</template>
