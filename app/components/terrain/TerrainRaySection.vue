<script setup lang="ts">
  import type { CompassPoint, TowerRaySection } from '#shared/types'

  /**
   * Why a tower sees what it sees in one direction, in the numbers of the ground:
   * a section of the terrain against the sentry's eyes, and a few sentences that
   * say what stands in the way and by how much. It reads one of the eight compass
   * lines of the diagram — the same arithmetic as the calculation, traced one
   * line at a time, so the explanation cannot disagree with the picture.
   */
  const props = defineProps<{
    siteId: number
    compass: CompassPoint
  }>()

  const emit = defineEmits<{
    /** The loaded line, for the map to draw; null while it loads or when it goes. */
    section: [ray: TowerRaySection | null]
    /** A distance along the line the reader is pointing at, for a dot on the map. */
    probe: [metres: number | null]
  }>()

  const { t } = useI18n()
  const { distance, metres } = useTerrainFormat()
  const { ray, isLoading, hasFailed } = useTowerRay(
    () => props.siteId,
    () => props.compass,
  )

  const direction = computed(() => t(`sightlines.compassTo.${props.compass}`))

  const showWhole = ref(false)

  /** The nearer scale: the crest and where ground returns, with room round them, and at least a kilometre. */
  const NICE_EXTENTS = [1_000, 1_500, 2_000, 3_000, 4_000, 5_000, 7_500, 10_000]
  const nearExtent = computed(() => {
    const current = ray.value
    if (!current) return 1_000
    const anchors = [
      current.firstBlock?.atMetres ?? 0,
      current.deadGround?.toMetres ?? 0,
      current.deadGround?.reappearsAt?.atMetres ?? 0,
    ]
    const wanted = Math.max(1_000, Math.max(...anchors) * 1.5)
    const nice = NICE_EXTENTS.find((extent) => extent >= wanted) ?? current.radiusMetres
    return Math.min(nice, current.radiusMetres)
  })

  const canWiden = computed(() => (ray.value ? nearExtent.value < ray.value.radiusMetres : false))
  const extent = computed(() =>
    showWhole.value && ray.value ? ray.value.radiusMetres : nearExtent.value,
  )

  const signedAbove = (value: number): string => metres(Math.abs(value), 1)

  const sentences = computed((): string[] => {
    const current = ray.value
    if (!current) return []
    const lines: string[] = []
    const radius = distance(current.radiusMetres)
    const crest = current.firstBlock

    if (!crest) {
      lines.push(t('sightlines.why.open', { radius }))
    } else if (crest.aboveEyeMetres >= 0) {
      lines.push(
        t('sightlines.why.crestAboveEyes', {
          at: distance(crest.atMetres),
          rise: signedAbove(crest.aboveTowerGroundMetres),
          over: signedAbove(crest.aboveEyeMetres),
        }),
      )
    } else if (crest.aboveTowerGroundMetres >= 0) {
      lines.push(
        t('sightlines.why.crestBelowEyes', {
          at: distance(crest.atMetres),
          rise: signedAbove(crest.aboveTowerGroundMetres),
          under: signedAbove(crest.aboveEyeMetres),
        }),
      )
    } else {
      lines.push(
        t('sightlines.why.edge', {
          at: distance(crest.atMetres),
          drop: signedAbove(crest.aboveTowerGroundMetres),
        }),
      )
    }

    const dead = current.deadGround
    if (dead) {
      lines.push(
        t('sightlines.why.deadLongest', {
          from: distance(dead.fromMetres),
          to: distance(dead.toMetres),
          length: distance(dead.toMetres - dead.fromMetres),
          crestAt: distance(dead.crest.atMetres),
        }),
      )
      const again = dead.reappearsAt
      if (again) {
        const key =
          again.aboveTowerGroundMetres >= 0
            ? 'sightlines.why.againAbove'
            : 'sightlines.why.againBelow'
        lines.push(
          t(key, {
            at: distance(again.atMetres),
            rise: signedAbove(again.aboveTowerGroundMetres),
          }),
        )
      } else {
        lines.push(t('sightlines.why.never', { radius }))
      }
    }

    const totalKey = current.hiddenMetres > 0 ? 'sightlines.why.total' : 'sightlines.why.totalOpen'
    lines.push(
      t(totalKey, {
        seen: distance(current.seenMetres),
        hidden: distance(current.hiddenMetres),
        far: distance(current.farthestSeenMetres),
      }),
    )
    return lines
  })

  const summary = computed(() => {
    const current = ray.value
    if (!current) return ''
    return t('sightlines.why.chartLabel', {
      direction: direction.value,
      extent: distance(extent.value),
      seen: distance(current.seenMetres),
      end: distance(current.firstBlock?.atMetres ?? current.radiusMetres),
    })
  })

  const scrub = (index: number | null): void => {
    const current = ray.value
    emit('probe', index === null || !current ? null : (current.distances[index] ?? null))
  }

  watch(
    ray,
    (current) => {
      emit('section', current)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    emit('section', null)
    emit('probe', null)
  })
</script>

<template>
  <section class="mt-4 rounded-notebook border border-paper-200 p-3 dark:border-night-700">
    <h3 class="font-display text-lg text-ink-900 dark:text-paper-100">
      {{ t('sightlines.why.heading', { direction }) }}
    </h3>

    <div v-if="isLoading" class="mt-2 space-y-2" role="status">
      <span class="sr-only">{{ t('sightlines.why.loading') }}</span>
      <div class="h-3 w-5/6 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
      <div class="h-32 w-full animate-pulse rounded bg-paper-200 dark:bg-night-700" />
    </div>

    <p v-else-if="hasFailed && !ray" class="mt-2 text-sm text-ink-500 dark:text-paper-400">
      {{ t('sightlines.why.failed') }}
    </p>

    <template v-else-if="ray">
      <ul class="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        <li v-for="(sentence, index) in sentences" :key="index">{{ sentence }}</li>
      </ul>

      <TerrainRayChart
        class="mt-3"
        :ray="ray"
        :x-max-metres="extent"
        :summary="summary"
        :scrub-label="t('sightlines.why.scrub')"
        :crest-label="t('sightlines.why.keyCrest')"
        :again-label="t('sightlines.why.keyAgain')"
        @scrub="scrub"
      />

      <button
        v-if="canWiden"
        type="button"
        class="mt-2 text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
        @click="showWhole = !showWhole"
      >
        {{
          showWhole
            ? t('sightlines.why.showNear')
            : t('sightlines.why.showWhole', { radius: distance(ray.radiusMetres) })
        }}
      </button>
    </template>
  </section>
</template>
