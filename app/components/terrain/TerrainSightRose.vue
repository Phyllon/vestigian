<script setup lang="ts">
  import type { CompassPoint, SeenGrid, TowerSightlines } from '#shared/types'
  import { COMPASS_POINTS } from '#shared/types'
  import { cellsOfGrid, farthestSeenBySector, seenRuns } from '#shared/utils/seen-grid'
  import { SIGHTLINE_RING_METRES } from '#shared/utils/sightline-overlay'
  import type { SightlineMode } from '#shared/utils/sightline-overlay'

  /**
   * The tower's view as a polar diagram: where it sees, how far, and what stops
   * it — with the figures written on it.
   *
   * **The radius is a square-root scale of distance**, fixed at ten kilometres for
   * every tower. On a linear scale a tower on a wooded ridge — an open view of
   * 200 m and a valley side seen at 8 km — is a speck in the middle of an empty
   * target; the square root gives the first kilometre a third of the radius and
   * still reaches ten, and because it is the same for every tower, two diagrams
   * are comparable. The rings say what it is (500 m, 1, 2, 5, 10 km). The map
   * itself is drawn to true scale; this is a diagram, and says so in its caption.
   *
   * What is drawn: the ground seen at all, as wedges; the unbroken view as an
   * outline at the middle height estimate with the lower and higher dashed; the
   * nearby towers as dots with their numbers; and at each compass point the open
   * distance and the farthest ground seen. The picture is for the eye; every
   * figure on it is also in the list beneath, which is what a screen reader gets.
   */
  const props = defineProps<{
    sightlines: TowerSightlines
    mode: SightlineMode
    selected: CompassPoint | null
    label: string
  }>()

  const emit = defineEmits<{ select: [compass: CompassPoint] }>()

  const { t } = useI18n()
  const { distance } = useTerrainFormat()

  const SIZE = 340
  const CENTRE = SIZE / 2
  const RADIUS = 104
  const MAXIMUM_METRES = 10_000

  const scale = (metres: number): number =>
    RADIUS * Math.sqrt(Math.min(Math.max(metres, 0), MAXIMUM_METRES) / MAXIMUM_METRES)

  const pointAt = (bearingDegrees: number, metres: number, extra = 0): { x: number; y: number } => {
    const angle = (bearingDegrees * Math.PI) / 180
    const length = scale(metres) + extra
    return { x: CENTRE + length * Math.sin(angle), y: CENTRE - length * Math.cos(angle) }
  }

  const fixed = (value: number): string => String(Math.round(value * 10) / 10)

  const grid = computed((): SeenGrid =>
    props.mode === 'view' ? props.sightlines.viewGrid : props.sightlines.seenFrom.grid,
  )

  const cells = computed(() => cellsOfGrid(grid.value))

  /**
   * Seen runs as annular wedges. Neighbouring one-degree columns that hold the
   * same run are one wedge: fewer path commands for the same picture.
   */
  const wedgePath = computed(() => {
    const shape = grid.value
    const open = new Map<string, { fromBin: number; toBin: number; first: number; last: number }>()
    const wedges: { fromBin: number; toBin: number; first: number; last: number }[] = []

    for (const run of seenRuns(cells.value, shape)) {
      const key = `${run.fromBin}-${run.toBin}`
      const previous = open.get(key)
      if (previous && previous.last === run.column - 1) {
        previous.last = run.column
      } else {
        const wedge = {
          fromBin: run.fromBin,
          toBin: run.toBin,
          first: run.column,
          last: run.column,
        }
        open.set(key, wedge)
        wedges.push(wedge)
      }
    }

    const degrees = 360 / shape.columns
    return wedges
      .map((wedge) => {
        const start = wedge.first * degrees
        const end = (wedge.last + 1) * degrees
        const inner = scale(wedge.fromBin * shape.binMetres)
        const outer = scale(wedge.toBin * shape.binMetres)
        const outerStart = pointAt(start, wedge.toBin * shape.binMetres)
        const outerEnd = pointAt(end, wedge.toBin * shape.binMetres)
        const innerEnd = pointAt(end, wedge.fromBin * shape.binMetres)
        const innerStart = pointAt(start, wedge.fromBin * shape.binMetres)
        const large = end - start > 180 ? 1 : 0
        const back =
          inner === 0
            ? `L${fixed(CENTRE)} ${fixed(CENTRE)}`
            : `L${fixed(innerEnd.x)} ${fixed(innerEnd.y)} A${fixed(inner)} ${fixed(inner)} 0 ${large} 0 ${fixed(innerStart.x)} ${fixed(innerStart.y)}`
        return `M${fixed(outerStart.x)} ${fixed(outerStart.y)} A${fixed(outer)} ${fixed(outer)} 0 ${large} 1 ${fixed(outerEnd.x)} ${fixed(outerEnd.y)} ${back}Z`
      })
      .join('')
  })

  const outlinePath = (unbrokenMetres: number[]): string => {
    const stride = 4
    const points: string[] = []
    for (let ray = 0; ray < unbrokenMetres.length; ray += stride) {
      const point = pointAt((ray * 360) / unbrokenMetres.length, unbrokenMetres[ray]!)
      points.push(`${fixed(point.x)} ${fixed(point.y)}`)
    }
    return `M${points.join(' L')} Z`
  }

  const outlines = computed(() => ({
    low: outlinePath(props.sightlines.variants.low.unbrokenMetres),
    central: outlinePath(props.sightlines.variants.central.unbrokenMetres),
    high: outlinePath(props.sightlines.variants.high.unbrokenMetres),
  }))

  const BEARINGS: Record<CompassPoint, number> = {
    n: 0,
    ne: 45,
    e: 90,
    se: 135,
    s: 180,
    sw: 225,
    w: 270,
    nw: 315,
  }

  const farthest = computed(() => farthestSeenBySector(cells.value, grid.value))

  interface RimLabel {
    compass: CompassPoint
    x: number
    y: number
    anchor: 'start' | 'middle' | 'end'
    /** Left edge of a hit area 46 wide, whichever side of the point the text runs. */
    hitX: number
    name: string
    open: string | null
    far: string
  }

  const rim = computed((): RimLabel[] =>
    COMPASS_POINTS.map((compass) => {
      const bearing = BEARINGS[compass]
      const place = pointAt(bearing, MAXIMUM_METRES, 22)
      const sector = props.sightlines.variants.central.sectors.find(
        (candidate) => candidate.compass === compass,
      )
      let anchor: RimLabel['anchor'] = 'middle'
      let hitX = place.x - 23
      if (bearing > 0 && bearing < 180) {
        anchor = 'start'
        hitX = place.x
      }
      if (bearing > 180) {
        anchor = 'end'
        hitX = place.x - 46
      }
      const far = farthest.value[compass]
      return {
        compass,
        x: place.x,
        y: place.y,
        anchor,
        hitX,
        name: t(`sightlines.compassShort.${compass}`),
        open: props.mode === 'view' && sector ? distance(sector.medianMetres) : null,
        far: far > 0 ? distance(far) : '–',
      }
    }),
  )

  /** The 500 m ring is drawn and named in the caption; its label would sit on the tower's own marks. */
  const ringLabels = computed(() =>
    SIGHTLINE_RING_METRES.map((metres) => {
      const place = pointAt(112.5, metres)
      return {
        metres,
        text: distance(metres),
        x: place.x,
        y: place.y,
        radius: scale(metres),
        hasLabel: metres >= 1_000,
      }
    }),
  )

  const shortName = (title: string): string => title.replace(/^Turm\s+/i, '')

  const neighbours = computed(() =>
    props.sightlines.neighbours.map((neighbour) => {
      const place = pointAt(neighbour.bearing, neighbour.distanceMetres)
      return {
        id: neighbour.id,
        x: place.x,
        y: place.y,
        name: shortName(neighbour.title),
        isHidden: !neighbour.isClear.central,
        hasLabel: neighbour.distanceMetres > 60,
      }
    }),
  )

  const selectedSpoke = computed(() => {
    if (!props.selected) return null
    return pointAt(BEARINGS[props.selected], MAXIMUM_METRES)
  })

  const tone = computed(() =>
    props.mode === 'view'
      ? {
          stroke: 'stroke-[#9a5b06] dark:stroke-[#f0b94d]',
          fill: 'fill-[#d98a1c] dark:fill-[#f0b94d]',
        }
      : {
          stroke: 'stroke-[#2f5f86] dark:stroke-[#8fb8d6]',
          fill: 'fill-[#2f5f86] dark:fill-[#8fb8d6]',
        },
  )
</script>

<template>
  <figure class="m-0 flex flex-col items-center gap-2">
    <svg
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      class="block h-auto w-full max-w-[22rem]"
      role="img"
      :aria-label="label"
    >
      <!-- Rings: the same five distances for every tower, so two diagrams compare. -->
      <g fill="none" class="stroke-paper-300 dark:stroke-night-600" stroke-width="0.8">
        <circle
          v-for="ring in ringLabels"
          :key="ring.metres"
          :cx="CENTRE"
          :cy="CENTRE"
          :r="ring.radius"
        />
        <line :x1="CENTRE" :y1="CENTRE - RADIUS" :x2="CENTRE" :y2="CENTRE + RADIUS" />
        <line :x1="CENTRE - RADIUS" :y1="CENTRE" :x2="CENTRE + RADIUS" :y2="CENTRE" />
      </g>

      <!-- Everything seen, beyond a rise as well as before it. -->
      <path :d="wedgePath" :class="tone.fill" fill-opacity="0.2" />

      <template v-if="mode === 'view'">
        <path
          :d="outlines.high"
          fill="none"
          stroke-width="1"
          stroke-dasharray="3 2"
          :class="tone.stroke"
        />
        <path
          :d="outlines.low"
          fill="none"
          stroke-width="1"
          stroke-dasharray="3 2"
          :class="tone.stroke"
        />
        <path
          :d="outlines.central"
          stroke-width="1.8"
          fill-opacity="0.32"
          :class="[tone.stroke, tone.fill]"
        />
      </template>

      <line
        v-if="selectedSpoke"
        :x1="CENTRE"
        :y1="CENTRE"
        :x2="selectedSpoke.x"
        :y2="selectedSpoke.y"
        stroke-width="1.6"
        stroke-dasharray="1 3"
        stroke-linecap="round"
        class="stroke-ink-900 dark:stroke-paper-100"
      />

      <!-- Ring distances, set in the gap between the east and south-east spokes. -->
      <g
        class="fill-ink-500 font-mono text-[8px] [paint-order:stroke] dark:fill-paper-400"
        aria-hidden="true"
      >
        <text
          v-for="ring in ringLabels.filter((candidate) => candidate.hasLabel)"
          :key="`label-${ring.metres}`"
          :x="ring.x + 2"
          :y="ring.y + 3"
          class="stroke-paper-50 dark:stroke-night-800"
          stroke-width="3"
        >
          {{ ring.text }}
        </text>
      </g>

      <g v-for="point in neighbours" :key="point.id" aria-hidden="true">
        <circle
          :cx="point.x"
          :cy="point.y"
          r="3"
          stroke-width="1.2"
          :class="
            point.isHidden
              ? 'fill-paper-50 stroke-ink-500 dark:fill-night-800 dark:stroke-paper-400'
              : 'fill-ink-700 stroke-ink-700 dark:fill-paper-200 dark:stroke-paper-200'
          "
        />
        <text
          v-if="point.hasLabel"
          :x="point.x + 5"
          :y="point.y - 4"
          class="fill-ink-700 stroke-paper-50 font-mono text-[7.5px] [paint-order:stroke] dark:fill-paper-200 dark:stroke-night-800"
          stroke-width="2.5"
        >
          {{ point.name }}
        </text>
      </g>

      <circle :cx="CENTRE" :cy="CENTRE" r="3.4" class="fill-oxide-600 dark:fill-oxide-300" />

      <!-- The eight compass points and what the view is in each. Click one: the list below explains it. -->
      <g
        v-for="item in rim"
        :key="item.compass"
        class="cursor-pointer"
        aria-hidden="true"
        @click="emit('select', item.compass)"
      >
        <text
          :x="item.x"
          :y="item.y - (item.open === null ? 0 : 1)"
          :text-anchor="item.anchor"
          class="font-mono text-[10px]"
          :class="
            selected === item.compass
              ? 'fill-ink-900 font-bold dark:fill-paper-100'
              : 'fill-ink-700 dark:fill-paper-200'
          "
        >
          {{ item.name }}
          <tspan v-if="item.open" class="font-bold">{{ item.open }}</tspan>
        </text>
        <text
          :x="item.x"
          :y="item.y + 10"
          :text-anchor="item.anchor"
          class="fill-ink-500 font-mono text-[8.5px] dark:fill-paper-400"
        >
          {{ t('sightlines.rimFar', { distance: item.far }) }}
        </text>
        <!-- A hit area bigger than the glyphs: a thumb is not a pointer. -->
        <rect :x="item.hitX" :y="item.y - 12" width="46" height="28" fill="transparent" />
      </g>
    </svg>

    <figcaption
      class="max-w-prose text-center text-xs leading-relaxed text-ink-500 dark:text-paper-400"
    >
      {{ t(mode === 'view' ? 'sightlines.roseScale' : 'sightlines.roseScaleSeenFrom') }}
    </figcaption>
  </figure>
</template>
