<script setup lang="ts">
  import type { CompassPoint, SightlineVariant, TowerRaySection } from '#shared/types'
  import { cellsOfGrid, farthestSeenBySector } from '#shared/utils/seen-grid'
  import { compassPointFor, destinationPoint } from '#shared/utils/sightline'
  import { buildRayLines, buildSightlineMapGeometry } from '#shared/utils/sightline-overlay'
  import type { SightlineMode } from '#shared/utils/sightline-overlay'

  /**
   * What a frontier tower's guard platform could have seen, over bare ground — the
   * calculation in `shared/utils/sightline.ts`, told four ways so none of them has
   * to be the only way: a polar diagram with its figures written on it, the same
   * view in eight compass rows, the numbers of the ground behind any one of them,
   * and (where there is a map) the same shapes and the same figures drawn on the
   * ground itself.
   *
   * Everything here is a calculation from an estimated height and a terrain model.
   * The section says so before it says anything else, and shows the range of
   * heights rather than one number. See `.claude/rules/sightlines.md`.
   */
  const props = defineProps<{ siteId: number }>()

  const { t } = useI18n()
  const { distance, metres, squareKilometres, number, plain, percent } = useTerrainFormat()
  const { isCompact } = useBreakpoint()
  const { sightlines, isLoading, hasFailed } = useTowerSightlines(() => props.siteId)
  const { showSightlines, clearSightlines, probe } = useSightlineOverlay()

  /** `null` on a reading page, where there is no map to draw on. */
  const mapInstance = useOptionalMapInstance()
  const hasMap = mapInstance !== null

  const isShownOnMap = ref(true)
  const mode = ref<SightlineMode>('view')
  const selectedCompass = ref<CompassPoint | null>(null)
  const selectedNeighbourId = ref<number | null>(null)
  const rayLoaded = shallowRef<TowerRaySection | null>(null)

  const central = computed(() => sightlines.value?.variants.central ?? null)
  const radiusKm = computed(() => (sightlines.value?.radiusMetres ?? 0) / 1000)

  /** "to the north-east" — the preposition is part of the phrase, which is how it differs by language. */
  const directionName = (bearing: number): string =>
    t(`sightlines.compassTo.${compassPointFor(bearing)}`)

  const circleAreaSquareKm = computed(() => Math.PI * radiusKm.value ** 2)

  const viewCells = computed(() =>
    sightlines.value ? cellsOfGrid(sightlines.value.viewGrid) : null,
  )
  const seenFromCells = computed(() =>
    sightlines.value ? cellsOfGrid(sightlines.value.seenFrom.grid) : null,
  )

  const viewFarthest = computed(() =>
    viewCells.value && sightlines.value
      ? farthestSeenBySector(viewCells.value, sightlines.value.viewGrid)
      : null,
  )
  const seenFromFarthest = computed(() =>
    seenFromCells.value && sightlines.value
      ? farthestSeenBySector(seenFromCells.value, sightlines.value.seenFrom.grid)
      : null,
  )

  const lead = computed(() => {
    const current = central.value
    const data = sightlines.value
    if (!current || !data) return ''
    return t('sightlines.lead', {
      eye: plain(current.eyeHeightMetres, 1),
      area: squareKilometres(current.unbrokenAreaSquareKm),
      distance: distance(current.longestUnbroken.metres),
      direction: directionName(current.longestUnbroken.bearing),
    })
  })

  const leadSeen = computed(() => {
    const current = central.value
    if (!current) return ''
    return t('sightlines.leadSeen', {
      area: squareKilometres(current.visibleAreaSquareKm),
      share: percent(current.visibleAreaSquareKm / circleAreaSquareKm.value),
      radius: number(radiusKm.value, 0),
      distance: distance(current.farthestVisible.metres),
      direction: directionName(current.farthestVisible.bearing),
    })
  })

  const seenFromLead = computed(() => {
    const data = sightlines.value
    if (!data) return ''
    return t('sightlines.seenFromLead', {
      tower: plain(data.seenFrom.towerMetres.central, 1),
      area: squareKilometres(data.seenFrom.visibleAreaSquareKm.central),
      distance: distance(data.seenFrom.farthestVisible.metres),
      direction: directionName(data.seenFrom.farthestVisible.bearing),
    })
  })

  /** The square-root scale of the diagram, so the bars and the picture agree. */
  const barFraction = (metresOut: number): number =>
    Math.max(0.02, Math.min(1, Math.sqrt(Math.max(metresOut, 0) / 10_000)))

  const sectorRows = computed(() => {
    const data = sightlines.value
    const current = central.value
    if (!data || !current) return []
    return current.sectors.map((sector) => {
      const far =
        (mode.value === 'view' ? viewFarthest.value : seenFromFarthest.value)?.[sector.compass] ?? 0
      const label = t(`sightlines.compass.${sector.compass}`)
      return {
        compass: sector.compass,
        label,
        openMetres: sector.medianMetres,
        farMetres: far,
        openFraction: barFraction(sector.medianMetres),
        farFraction: barFraction(far),
        isOpenToLimit: sector.shortestMetres >= data.radiusMetres * 0.98,
        aria: t('sightlines.sectorRowLabel', {
          direction: label,
          open: distance(sector.medianMetres),
          far: distance(far),
        }),
      }
    })
  })

  const selectCompass = (compass: CompassPoint): void => {
    if (mode.value !== 'view') return
    selectedCompass.value = selectedCompass.value === compass ? null : compass
  }

  type NeighbourState = 'clear' | 'notLow' | 'onlyHigh' | 'hidden'

  const stateOf = (neighbour: { isClear: Record<SightlineVariant, boolean> }): NeighbourState => {
    const { low, central: middle, high } = neighbour.isClear
    if (low && middle && high) return 'clear'
    if (middle && high) return 'notLow'
    if (high) return 'onlyHigh'
    return 'hidden'
  }

  const nameOfState = (state: NeighbourState): string => t(`sightlines.state.${state}`)

  const neighbourRows = computed(() =>
    (sightlines.value?.neighbours ?? []).map((neighbour) => {
      const state = stateOf(neighbour)
      const margin = Math.abs(neighbour.minimumClearanceMetres)
      const detailKey =
        neighbour.minimumClearanceMetres >= 0
          ? 'sightlines.neighbourClearance'
          : 'sightlines.neighbourBlockedBy'
      return {
        neighbour,
        state,
        where: t('sightlines.neighbourLine', {
          distance: distance(neighbour.distanceMetres),
          direction: directionName(neighbour.bearing),
        }),
        detail: t(detailKey, {
          metres: number(margin, 1),
          distance: distance(neighbour.tightestAtMetres),
        }),
      }
    }),
  )

  const selectedNeighbour = computed(() => {
    const rows = sightlines.value?.neighbours ?? []
    return rows.find((row) => row.id === selectedNeighbourId.value) ?? rows[0] ?? null
  })

  const roseLabel = computed(() =>
    t(mode.value === 'view' ? 'sightlines.roseLabel' : 'sightlines.roseLabelSeenFrom', {
      radius: number(radiusKm.value, 0),
    }),
  )

  const profileSummary = computed(() => {
    const neighbour = selectedNeighbour.value
    if (!neighbour) return ''
    return t('sightlines.profileLabel', {
      title: neighbour.title,
      distance: distance(neighbour.distanceMetres),
      state: nameOfState(stateOf(neighbour)),
    })
  })

  const overlayText = {
    distance,
    compassShort: (point: CompassPoint): string => t(`sightlines.compassShort.${point}`),
    farthest: (metresOut: number): string =>
      t('sightlines.mapFarthest', { distance: distance(metresOut) }),
  }

  const fitView = (): void => {
    const map = mapInstance?.value
    const data = sightlines.value
    if (!map || !data) return
    // The ten-kilometre ring is the whole of it; the tower's own surroundings are
    // what a reader wants in frame, so fit the kilometre-and-a-half round it, or
    // the longest open view, whichever is more.
    const reach = Math.max(1_500, data.variants.high.longestUnbroken.metres * 1.2)
    const corners = [0, 90, 180, 270].map((bearing) =>
      destinationPoint(data.position, bearing, reach),
    )
    const height = map.getContainer().clientHeight
    // The record sheet covers the lower part of a phone and the right of a desktop.
    const padding = isCompact.value
      ? { top: 70, left: 24, right: 24, bottom: Math.round(height * 0.76) }
      : { top: 70, left: 24, right: 440, bottom: 24 }
    map.fitBounds(
      [
        [Math.min(...corners.map((c) => c.lon)), Math.min(...corners.map((c) => c.lat))],
        [Math.max(...corners.map((c) => c.lon)), Math.max(...corners.map((c) => c.lat))],
      ],
      { padding, maxZoom: 16, duration: 600 },
    )
  }

  const publishToMap = (): void => {
    const data = sightlines.value
    if (!hasMap || !data || !isShownOnMap.value) {
      clearSightlines(props.siteId)
      return
    }
    const neighbour = selectedNeighbour.value
    showSightlines({
      towerId: props.siteId,
      mode: mode.value,
      geometry: buildSightlineMapGeometry(data, mode.value, overlayText),
      link:
        neighbour && mode.value === 'view'
          ? [
              [data.position.lon, data.position.lat],
              [neighbour.position.lon, neighbour.position.lat],
            ]
          : null,
      rayLines:
        rayLoaded.value && mode.value === 'view'
          ? buildRayLines(data.position, rayLoaded.value)
          : [],
    })
  }

  const showNeighbourProbe = (index: number | null): void => {
    const neighbour = selectedNeighbour.value
    const data = sightlines.value
    if (index === null || !neighbour || !data) {
      probe.value = null
      return
    }
    const fraction =
      (neighbour.profile.distances[index] ?? 0) / Math.max(neighbour.distanceMetres, 1)
    probe.value = {
      lon: data.position.lon + (neighbour.position.lon - data.position.lon) * fraction,
      lat: data.position.lat + (neighbour.position.lat - data.position.lat) * fraction,
    }
  }

  const showRayProbe = (metresOut: number | null): void => {
    const data = sightlines.value
    const ray = rayLoaded.value
    if (metresOut === null || !data || !ray) {
      probe.value = null
      return
    }
    probe.value = destinationPoint(data.position, ray.bearing, metresOut)
  }

  // The map follows the mode, the chosen line and the chosen neighbour; the line
  // belongs to the view and is dropped when the other relation is on show.
  watch(mode, (next) => {
    if (next !== 'view') selectedCompass.value = null
  })
  watch([sightlines, isShownOnMap, mode, selectedNeighbour, rayLoaded], publishToMap, {
    immediate: true,
  })

  onBeforeUnmount(() => {
    clearSightlines(props.siteId)
    probe.value = null
  })
</script>

<template>
  <section v-if="isLoading || sightlines || hasFailed" aria-labelledby="tower-sightlines-heading">
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="tower-sightlines-heading" class="eyebrow">{{ t('sightlines.title') }}</h2>
      <span
        class="rounded-full border border-ink-400 px-2 text-xs leading-5 text-ink-700 dark:border-paper-500 dark:text-paper-200"
      >
        {{ t('sightlines.calculatedTag') }}
      </span>
    </div>

    <div v-if="isLoading" class="mt-2 space-y-2" role="status">
      <span class="sr-only">{{ t('sightlines.loading') }}</span>
      <div class="h-4 w-5/6 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
      <div class="h-40 w-full animate-pulse rounded bg-paper-200 dark:bg-night-700" />
    </div>

    <p v-else-if="hasFailed && !sightlines" class="mt-2 text-sm text-ink-500 dark:text-paper-400">
      {{ t('sightlines.failed') }}
    </p>

    <template v-else-if="sightlines && central">
      <!-- The two relations: what the tower sees, and where it is seen from. -->
      <div
        class="mt-3 inline-flex rounded-notebook border border-paper-300 p-0.5 dark:border-night-600"
        role="group"
        :aria-label="t('sightlines.modeLabel')"
      >
        <button
          type="button"
          class="rounded-[2px] px-3 py-1 text-sm transition"
          :class="
            mode === 'view'
              ? 'bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-ink-900'
              : 'text-ink-700 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-night-700'
          "
          :aria-pressed="mode === 'view'"
          @click="mode = 'view'"
        >
          {{ t('sightlines.modeView') }}
        </button>
        <button
          type="button"
          class="rounded-[2px] px-3 py-1 text-sm transition"
          :class="
            mode === 'seenFrom'
              ? 'bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-ink-900'
              : 'text-ink-700 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-night-700'
          "
          :aria-pressed="mode === 'seenFrom'"
          @click="mode = 'seenFrom'"
        >
          {{ t('sightlines.modeSeenFrom') }}
        </button>
      </div>

      <template v-if="mode === 'view'">
        <p class="mt-3 text-[0.95rem] leading-relaxed text-ink-700 dark:text-paper-200">
          {{ lead }}
          {{ leadSeen }}
        </p>
      </template>
      <template v-else>
        <p class="mt-3 text-[0.95rem] leading-relaxed text-ink-700 dark:text-paper-200">
          {{ seenFromLead }}
        </p>
        <p class="mt-2 text-sm leading-relaxed text-ink-500 dark:text-paper-400">
          {{ t('sightlines.seenFromWhy') }}
        </p>
      </template>

      <div v-if="hasMap" class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <USwitch v-model="isShownOnMap" :label="t('sightlines.showOnMap')" size="sm" />
        <button
          v-if="isShownOnMap"
          type="button"
          class="text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
          @click="fitView"
        >
          {{ t('sightlines.fitView') }}
        </button>
      </div>

      <TerrainSightRose
        class="mt-4"
        :sightlines="sightlines"
        :mode="mode"
        :selected="selectedCompass"
        :label="roseLabel"
        @select="selectCompass"
      />

      <dl
        v-if="mode === 'view'"
        class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
      >
        <dt class="eyebrow pt-0.5">{{ t('sightlines.factHeight') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factHeightValue', {
              eye: number(central.eyeHeightMetres, 1),
              low: number(sightlines.variants.low.eyeHeightMetres, 1),
              high: number(sightlines.variants.high.eyeHeightMetres, 1),
              ground: metres(sightlines.groundElevationMetres),
            })
          }}
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('sightlines.factOpen') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factOpenValue', {
              area: squareKilometres(central.unbrokenAreaSquareKm),
              low: squareKilometres(sightlines.variants.low.unbrokenAreaSquareKm),
              high: squareKilometres(sightlines.variants.high.unbrokenAreaSquareKm),
            })
          }}
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('sightlines.factSeen') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factSeenValue', {
              area: squareKilometres(central.visibleAreaSquareKm),
              share: percent(central.visibleAreaSquareKm / circleAreaSquareKm),
              radius: number(radiusKm, 0),
            })
          }}
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('sightlines.factFarthest') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factDirectionValue', {
              distance: distance(central.farthestVisible.metres),
              direction: directionName(central.farthestVisible.bearing),
            })
          }}
        </dd>
      </dl>

      <dl
        v-else
        class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
      >
        <dt class="eyebrow pt-0.5">{{ t('sightlines.factTower') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factTowerValue', {
              tower: number(sightlines.seenFrom.towerMetres.central, 1),
              low: number(sightlines.seenFrom.towerMetres.low, 1),
              high: number(sightlines.seenFrom.towerMetres.high, 1),
              eye: number(sightlines.seenFrom.onlookerEyeMetres, 1),
            })
          }}
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('sightlines.factSeenFrom') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factSeenFromValue', {
              area: squareKilometres(sightlines.seenFrom.visibleAreaSquareKm.central),
              low: squareKilometres(sightlines.seenFrom.visibleAreaSquareKm.low),
              high: squareKilometres(sightlines.seenFrom.visibleAreaSquareKm.high),
              share: percent(sightlines.seenFrom.visibleAreaSquareKm.central / circleAreaSquareKm),
              radius: number(radiusKm, 0),
            })
          }}
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('sightlines.factFarthest') }}</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">
          {{
            t('sightlines.factDirectionValue', {
              distance: distance(sightlines.seenFrom.farthestVisible.metres),
              direction: directionName(sightlines.seenFrom.farthestVisible.bearing),
            })
          }}
        </dd>
      </dl>

      <h3 class="eyebrow mt-4">{{ t('sightlines.compassHeading') }}</h3>
      <p v-if="mode === 'view'" class="mt-1 text-xs text-ink-500 dark:text-paper-400">
        {{ t('sightlines.compassHint') }}
      </p>
      <ul class="mt-2 space-y-1">
        <li v-for="row in sectorRows" :key="row.compass">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-notebook px-2 py-1 text-left text-sm transition"
            :class="[
              mode === 'view' ? 'hover:bg-paper-100 dark:hover:bg-night-700' : 'cursor-default',
              selectedCompass === row.compass ? 'bg-paper-100 dark:bg-night-700' : '',
            ]"
            :aria-label="row.aria"
            :aria-expanded="mode === 'view' ? selectedCompass === row.compass : undefined"
            :disabled="mode !== 'view'"
            @click="selectCompass(row.compass)"
          >
            <span class="w-24 shrink-0 text-ink-700 dark:text-paper-200">{{ row.label }}</span>
            <span
              class="relative h-2 flex-1 rounded-full bg-paper-200 dark:bg-night-700"
              aria-hidden="true"
            >
              <span
                class="absolute inset-y-0 left-0 rounded-full"
                :class="
                  mode === 'view'
                    ? 'bg-[#d98a1c]/35 dark:bg-[#f0b94d]/30'
                    : 'bg-[#2f5f86]/60 dark:bg-[#8fb8d6]/60'
                "
                :style="{ width: `${Math.round(row.farFraction * 100)}%` }"
              />
              <span
                v-if="mode === 'view'"
                class="absolute inset-y-0 left-0 rounded-full bg-[#9a5b06] dark:bg-[#f0b94d]"
                :style="{ width: `${Math.round(row.openFraction * 100)}%` }"
              />
            </span>
            <span class="datum w-36 shrink-0 text-right">
              <template v-if="mode === 'view'">
                {{ distance(row.openMetres) }}
                <span class="text-ink-500 dark:text-paper-400"
                  >→ {{ distance(row.farMetres) }}</span
                >
              </template>
              <template v-else>{{ distance(row.farMetres) }}</template>
            </span>
          </button>
        </li>
      </ul>

      <TerrainRaySection
        v-if="mode === 'view' && selectedCompass"
        :key="`${siteId}-${selectedCompass}`"
        :site-id="siteId"
        :compass="selectedCompass"
        @section="rayLoaded = $event"
        @probe="showRayProbe"
      />

      <h3 class="eyebrow mt-5">{{ t('sightlines.neighboursHeading') }}</h3>
      <p v-if="neighbourRows.length === 0" class="mt-2 text-sm text-ink-500 dark:text-paper-400">
        {{ t('sightlines.neighboursEmpty', { radius: number(5, 0) }) }}
      </p>
      <template v-else>
        <ul class="mt-2 space-y-1">
          <li v-for="row in neighbourRows" :key="row.neighbour.id">
            <button
              type="button"
              class="flex w-full items-start gap-3 rounded-notebook px-2 py-1.5 text-left text-sm transition hover:bg-paper-100 dark:hover:bg-night-700"
              :class="
                selectedNeighbour?.id === row.neighbour.id ? 'bg-paper-100 dark:bg-night-700' : ''
              "
              :aria-pressed="selectedNeighbour?.id === row.neighbour.id"
              @click="selectedNeighbourId = row.neighbour.id"
            >
              <UIcon
                :name="row.state === 'hidden' ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                class="mt-0.5 size-4 shrink-0 text-ink-500 dark:text-paper-400"
                aria-hidden="true"
              />
              <span class="min-w-0">
                <span class="block truncate text-ink-900 dark:text-paper-100">
                  {{ row.neighbour.title }}
                </span>
                <span class="block text-xs text-ink-500 dark:text-paper-400">
                  {{ row.where }} · {{ nameOfState(row.state) }}
                </span>
                <span class="block text-xs text-ink-500 dark:text-paper-400">{{ row.detail }}</span>
              </span>
            </button>
          </li>
        </ul>

        <TerrainProfileChart
          v-if="selectedNeighbour"
          :key="selectedNeighbour.id"
          class="mt-3"
          :distances="selectedNeighbour.profile.distances"
          :elevations="selectedNeighbour.profile.terrain"
          :sight="selectedNeighbour.profile.sight"
          :summary="profileSummary"
          :scrub-label="t('sightlines.scrubLabel')"
          :sight-label="t('sightlines.sightLabel')"
          @scrub="showNeighbourProbe"
        />
      </template>

      <p
        v-if="!sightlines.isBareEarthLikely"
        class="mt-4 rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-700 dark:bg-night-700 dark:text-paper-200"
      >
        {{ t('sightlines.surfaceWarning') }}
      </p>
      <p
        v-if="sightlines.terrainCoverage < 1"
        class="mt-2 rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-700 dark:bg-night-700 dark:text-paper-200"
      >
        {{ t('sightlines.partial') }}
      </p>

      <details class="mt-4 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
        <summary class="cursor-pointer text-ink-700 dark:text-paper-200">
          {{ t('sightlines.methodHeading') }}
        </summary>
        <p class="mt-2">
          {{
            t('sightlines.methodHeight', {
              platform: number(sightlines.platformMetres.central, 1),
              low: number(sightlines.platformMetres.low, 1),
              high: number(sightlines.platformMetres.high, 1),
              eyes: number(sightlines.eyeAbovePlatformMetres, 1),
            })
          }}
        </p>
        <p class="mt-2">
          {{
            t('sightlines.methodGround', {
              target: number(sightlines.targetHeightMetres, 1),
              radius: number(radiusKm, 0),
            })
          }}
        </p>
        <p class="mt-2">{{ t('sightlines.methodLimits') }}</p>
        <p class="mt-2">{{ t('sightlines.credit') }}</p>
      </details>
    </template>
  </section>
</template>
