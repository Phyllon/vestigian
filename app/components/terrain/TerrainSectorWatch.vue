<script setup lang="ts">
  /**
   * What the recorded towers of a frontier sector could do together: whether a
   * signal could pass along the line, where it would break, how much of the line
   * and of the country beside it is overlooked, and which stretches nothing
   * overlooks. The answer is worked out ahead of time by `pnpm sightlines:build`;
   * this is how it is read. See `.claude/rules/sightlines.md`.
   *
   * A native `<details>`: closed in the map's sector sheet, where the roll is the
   * thing a reader came for and the headline numbers sit on the summary line;
   * open on the sector's own page. On the map it can draw its ground, links and
   * gaps; on a reading page there is no map and the same facts are written out.
   */
  import type { TowerSpacingPair } from '#shared/types'
  import { SIGHTLINE_RADIUS_METRES as SPACING_RANGE_METRES } from '#shared/utils/sightline'
  import { TOWER_SPACING_MINIMUM_SPAN_METRES, spacingRatio } from '#shared/utils/tower-spacing'

  const props = withDefaults(defineProps<{ slug: string; open?: boolean }>(), { open: false })

  const { t, locale } = useI18n()
  const { distance, percent, squareKilometres, plain } = useTerrainFormat()
  const { summary, isLoading } = useSectorWatch(() => props.slug)

  const { takeRequestFor } = useSectorWatchOpenRequest()
  /** Follows the reader's own toggling; a request from the features page opens it once. */
  const isExpanded = ref(props.open || takeRequestFor(props.slug))

  /** `null` on a reading page, where there is no map to draw on. */
  const mapInstance = useOptionalMapInstance()
  const hasMap = mapInstance !== null
  const { showSectorWatch, clearSectorWatch } = useSectorWatchOverlay()

  const isOnMap = ref(false)
  const isLoadingLayers = ref(false)
  const hasLayerFailed = ref(false)

  const loadLayers = async (): Promise<void> => {
    isLoadingLayers.value = true
    hasLayerFailed.value = false
    try {
      const collection = await $fetch<GeoJSON.FeatureCollection>(
        `/api/limes/sectors/${props.slug}/sightlines.geojson`,
      )
      // The reader may have switched it off, or moved on, while it loaded.
      if (isOnMap.value) showSectorWatch(collection)
    } catch {
      hasLayerFailed.value = true
      isOnMap.value = false
    } finally {
      isLoadingLayers.value = false
    }
  }

  watch(isOnMap, (on) => {
    if (on) void loadLayers()
    else clearSectorWatch()
  })

  watch(
    () => props.slug,
    () => {
      isOnMap.value = false
      clearSectorWatch()
    },
  )

  const flyTo = (position: { lon: number; lat: number }): void => {
    const map = mapInstance?.value
    if (!map) return
    map.flyTo({
      center: [position.lon, position.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 700,
    })
  }

  const computedOn = computed(() => {
    if (!summary.value) return ''
    return new Date(summary.value.computedAt).toLocaleDateString(locale.value, {
      dateStyle: 'medium',
    })
  })

  /** Two neighbouring towers within range: without one there is no chain to read. */
  const hasChain = computed(() => (summary.value?.chainLengthMetres ?? 0) > 0)

  const BREAKS_SHOWN = 5
  const shownBreaks = computed(() => summary.value?.chainBreaks.slice(0, BREAKS_SHOWN) ?? [])
  const hiddenBreakCount = computed(() =>
    Math.max(0, (summary.value?.chainBreaks.length ?? 0) - BREAKS_SHOWN),
  )
  const shownBlind = computed(() => summary.value?.blindStretches.slice(0, BREAKS_SHOWN) ?? [])
  const hiddenBlindCount = computed(() =>
    Math.max(0, (summary.value?.blindStretches.length ?? 0) - BREAKS_SHOWN),
  )

  /** Absent on an answer worked out before the spacing reading existed. */
  const spacing = computed(() => summary.value?.spacing ?? null)
  const hasSpacing = computed(() => spacing.value !== null && spacing.value.isReadable)
  const tallestBin = computed(() =>
    Math.max(1, ...(spacing.value?.bins.map((bin) => bin.count) ?? [])),
  )
  const outlierGroups = computed(() => [
    {
      key: 'nearest',
      heading: 'sectorWatch.spacingNearestHeading',
      items: spacing.value?.nearestToLimit ?? [],
    },
    {
      key: 'farthest',
      heading: 'sectorWatch.spacingFarthestHeading',
      items: spacing.value?.farthestFromLimit ?? [],
    },
  ])

  /** A pair's share of its reach, for the list of outliers. */
  const shareOf = (pair: TowerSpacingPair): string => percent(spacingRatio(pair, 'central'))

  /** Bin edges are tenths: 0, 0.1 … 0.9. */
  const binRange = (fromRatio: number): { from: string; to: string } => ({
    from: percent(fromRatio),
    to: percent(Math.round((fromRatio + 0.1) * 10) / 10),
  })

  onBeforeUnmount(() => {
    if (isOnMap.value) clearSectorWatch()
  })
</script>

<template>
  <details
    v-if="isLoading || summary"
    class="group border-t border-paper-200 dark:border-night-700"
    :open="isExpanded"
    @toggle="isExpanded = ($event.target as HTMLDetailsElement).open"
  >
    <summary
      class="flex cursor-pointer list-none items-start gap-3 px-5 py-3 transition hover:bg-paper-100 dark:hover:bg-night-700"
    >
      <UIcon
        name="i-lucide-chevron-right"
        class="mt-0.5 size-4 shrink-0 text-ink-500 transition group-open:rotate-90 dark:text-paper-400"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-3">
          <span class="eyebrow">{{ t('sectorWatch.title') }}</span>
          <span
            class="shrink-0 rounded-full border border-ink-400 px-2 text-xs leading-5 text-ink-700 dark:border-paper-500 dark:text-paper-200"
          >
            {{ t('sightlines.calculatedTag') }}
          </span>
        </span>
        <span v-if="summary" class="mt-1 block text-sm text-ink-700 dark:text-paper-200">
          {{
            t(hasChain ? 'sectorWatch.headline' : 'sectorWatch.headlineNoChain', {
              chain: percent(summary.chainCoverage.central),
              seen: percent(summary.lineSeenShare),
              count: summary.towerCount,
            })
          }}
        </span>
        <span v-else class="mt-1 block text-sm text-ink-500 dark:text-paper-400">
          {{ t('sectorWatch.loading') }}
        </span>
      </span>
    </summary>

    <div v-if="summary" class="px-5 pb-4 pl-12">
      <div v-if="hasMap" class="mb-4">
        <USwitch v-model="isOnMap" :label="t('sectorWatch.showOnMap')" size="sm" />
        <p
          v-if="isLoadingLayers"
          class="mt-1 text-xs text-ink-500 dark:text-paper-400"
          role="status"
        >
          {{ t('sectorWatch.loadingLayers') }}
        </p>
        <p v-if="hasLayerFailed" class="mt-1 text-xs text-ink-500 dark:text-paper-400">
          {{ t('sectorWatch.layerFailed') }}
        </p>

        <ul
          v-if="isOnMap"
          class="mt-2 grid gap-1 text-xs text-ink-500 dark:text-paper-400"
          :aria-label="t('sectorWatch.keyHeading')"
        >
          <li class="flex items-center gap-2">
            <span class="inline-block h-3 w-5 bg-[#d98a1c]/25 dark:bg-[#f0b94d]/25" />
            {{ t('sectorWatch.keyOverlooked') }}
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-3 w-5 bg-[#d98a1c]/55 dark:bg-[#f0b94d]/50" />
            {{ t('sectorWatch.keyWatched') }}
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-0 w-5 border-t-2 border-[#9a5b06] dark:border-[#f0b94d]" />
            {{ t('sectorWatch.keyClear') }}
          </li>
          <li class="flex items-center gap-2">
            <span
              class="inline-block h-0 w-5 border-t-2 border-dotted border-[#9a5b06] dark:border-[#f0b94d]"
            />
            {{ t('sectorWatch.keyBridged') }}
          </li>
          <li class="flex items-center gap-2">
            <span
              class="inline-block h-0 w-5 border-t-[3px] border-dashed border-[#8a2b5c] dark:border-[#e58ab8]"
            />
            {{ t('sectorWatch.keyBroken') }}
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-1 w-5 rounded-full bg-[#8a2b5c] dark:bg-[#e58ab8]" />
            {{ t('sectorWatch.keyBlind') }}
          </li>
        </ul>
      </div>

      <p class="text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{
          t('sectorWatch.lead', {
            count: summary.towerCount,
            spacing: distance(summary.meanSpacingMetres),
          })
        }}
      </p>

      <h3 class="eyebrow mt-4">{{ t('sectorWatch.chainHeading') }}</h3>
      <p v-if="!hasChain" class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('sectorWatch.chainSparse', { range: plain(summary.linkRangeMetres / 1000, 1) }) }}
      </p>
      <p v-else class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{
          t('sectorWatch.chainBody', {
            covered: percent(summary.chainCoverage.central),
            length: distance(summary.chainLengthMetres),
            low: percent(summary.chainCoverage.low),
            high: percent(summary.chainCoverage.high),
          })
        }}
      </p>

      <p
        v-if="hasChain && summary.chainBreaks.length === 0"
        class="mt-2 text-sm text-ink-500 dark:text-paper-400"
      >
        {{ t('sectorWatch.breaksNone') }}
      </p>
      <template v-else-if="hasChain">
        <p class="mt-2 text-xs text-ink-500 dark:text-paper-400">
          {{ t('sectorWatch.breaksHeading', { count: summary.chainBreaks.length }) }}
        </p>
        <ul class="mt-1 space-y-0.5">
          <li v-for="item in shownBreaks" :key="`${item.fromSiteId}-${item.toSiteId}`">
            <button
              v-if="hasMap"
              type="button"
              class="w-full rounded-notebook px-2 py-1 text-left text-sm hover:bg-paper-100 dark:hover:bg-night-700"
              @click="flyTo(item.position)"
            >
              {{
                t('sectorWatch.breakItem', {
                  from: item.fromTitle,
                  to: item.toTitle,
                  length: distance(item.lengthMetres),
                })
              }}
            </button>
            <span v-else class="block px-2 py-1 text-sm text-ink-700 dark:text-paper-200">
              {{
                t('sectorWatch.breakItem', {
                  from: item.fromTitle,
                  to: item.toTitle,
                  length: distance(item.lengthMetres),
                })
              }}
            </span>
          </li>
        </ul>
        <p v-if="hiddenBreakCount > 0" class="mt-1 px-2 text-xs text-ink-500 dark:text-paper-400">
          {{ t('sectorWatch.more', { count: hiddenBreakCount }) }}
        </p>
      </template>

      <template v-if="spacing">
        <h3 class="eyebrow mt-4">{{ t('sectorWatch.spacingHeading') }}</h3>
        <p v-if="!hasSpacing" class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
          {{ t('sectorWatch.spacingFew', { count: spacing.readCount }) }}
        </p>
        <template v-else>
          <p class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
            {{
              t('sectorWatch.spacingBody', {
                length: distance(spacing.medianLengthMetres),
                reach: distance(spacing.medianReachMetres),
                ratio: percent(spacing.medianRatio.central),
                low: percent(spacing.medianRatio.low),
                high: percent(spacing.medianRatio.high),
              })
            }}
          </p>

          <figure class="mt-3">
            <div
              class="flex h-16 items-end gap-0.5"
              role="img"
              :aria-label="t('sectorWatch.spacingChartLabel')"
            >
              <span
                v-for="bin in spacing.bins"
                :key="bin.fromRatio"
                class="min-w-0 flex-1 rounded-t-sm bg-[#d98a1c]/70 dark:bg-[#f0b94d]/65"
                :style="{
                  height: `${Math.max(bin.count > 0 ? 4 : 1, (bin.count / tallestBin) * 100)}%`,
                }"
              />
            </div>
            <figcaption
              class="mt-1 flex justify-between gap-3 text-xs text-ink-500 dark:text-paper-400"
              aria-hidden="true"
            >
              <span>{{ t('sectorWatch.spacingChartLow') }}</span>
              <span class="text-right">{{ t('sectorWatch.spacingChartHigh') }}</span>
            </figcaption>
            <ol class="sr-only">
              <li v-for="bin in spacing.bins" :key="bin.fromRatio">
                {{
                  t('sectorWatch.spacingBinItem', {
                    ...binRange(bin.fromRatio),
                    count: bin.count,
                  })
                }}
              </li>
            </ol>
          </figure>

          <p
            v-if="spacing.outOfSightCount > 0"
            class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200"
          >
            {{
              t('sectorWatch.spacingOutOfSight', {
                count: spacing.outOfSightCount,
                total: spacing.readCount,
              })
            }}
          </p>

          <template v-for="group in outlierGroups" :key="group.key">
            <template v-if="group.items.length > 0">
              <p class="mt-3 text-xs text-ink-500 dark:text-paper-400">
                {{ t(group.heading) }}
              </p>
              <ul class="mt-1 space-y-0.5">
                <li v-for="item in group.items" :key="`${item.fromSiteId}-${item.toSiteId}`">
                  <button
                    v-if="hasMap"
                    type="button"
                    class="w-full rounded-notebook px-2 py-1 text-left text-sm hover:bg-paper-100 dark:hover:bg-night-700"
                    @click="flyTo(item.position)"
                  >
                    {{
                      t('sectorWatch.spacingItem', {
                        from: item.fromTitle,
                        to: item.toTitle,
                        length: distance(item.lengthMetres),
                        share: shareOf(item),
                        reach: distance(item.reachMetres.central),
                      })
                    }}
                  </button>
                  <span v-else class="block px-2 py-1 text-sm text-ink-700 dark:text-paper-200">
                    {{
                      t('sectorWatch.spacingItem', {
                        from: item.fromTitle,
                        to: item.toTitle,
                        length: distance(item.lengthMetres),
                        share: shareOf(item),
                        reach: distance(item.reachMetres.central),
                      })
                    }}
                  </span>
                </li>
              </ul>
            </template>
          </template>

          <p
            v-if="spacing.cappedCount > 0"
            class="mt-3 text-xs leading-relaxed text-ink-500 dark:text-paper-400"
          >
            {{
              t('sectorWatch.spacingCapped', {
                count: spacing.cappedCount,
                range: distance(SPACING_RANGE_METRES),
              })
            }}
          </p>
          <p class="mt-2 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
            {{ t('sectorWatch.spacingMeaning') }}
          </p>
        </template>
        <p
          v-if="spacing.droppedCount > 0"
          class="mt-2 text-xs leading-relaxed text-ink-500 dark:text-paper-400"
        >
          {{
            t('sectorWatch.spacingDropped', {
              count: spacing.droppedCount,
              range: distance(TOWER_SPACING_MINIMUM_SPAN_METRES),
            })
          }}
        </p>
      </template>

      <h3 class="eyebrow mt-4">{{ t('sectorWatch.watchHeading') }}</h3>
      <p class="mt-1 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{
          t('sectorWatch.watchBody', {
            line: distance(summary.lineLengthMetres),
            seen: percent(summary.lineSeenShare),
            watched: percent(summary.lineWatchedShare),
            area: squareKilometres(summary.overlookedAreaSquareKm),
            watchedArea: squareKilometres(summary.watchedAreaSquareKm),
          })
        }}
      </p>

      <p
        v-if="summary.blindStretches.length === 0"
        class="mt-2 text-sm text-ink-500 dark:text-paper-400"
      >
        {{ t('sectorWatch.blindNone') }}
      </p>
      <template v-else>
        <p class="mt-2 text-xs text-ink-500 dark:text-paper-400">
          {{ t('sectorWatch.blindHeading', { count: summary.blindStretches.length }) }}
        </p>
        <ul class="mt-1 space-y-0.5">
          <li v-for="(item, index) in shownBlind" :key="index">
            <button
              v-if="hasMap"
              type="button"
              class="w-full rounded-notebook px-2 py-1 text-left text-sm hover:bg-paper-100 dark:hover:bg-night-700"
              @click="flyTo(item.position)"
            >
              {{ t('sectorWatch.blindItem', { length: distance(item.lengthMetres) }) }}
            </button>
            <span v-else class="block px-2 py-1 text-sm text-ink-700 dark:text-paper-200">
              {{ t('sectorWatch.blindItem', { length: distance(item.lengthMetres) }) }}
            </span>
          </li>
        </ul>
        <p v-if="hiddenBlindCount > 0" class="mt-1 px-2 text-xs text-ink-500 dark:text-paper-400">
          {{ t('sectorWatch.more', { count: hiddenBlindCount }) }}
        </p>
      </template>

      <p class="mt-4 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
        {{
          t('sectorWatch.basis', {
            date: computedOn,
            count: summary.towerCount,
            folded: summary.foldedRecordCount,
          })
        }}
        <span v-if="summary.recordGapCount > 0">
          {{
            t('sectorWatch.gaps', {
              count: summary.recordGapCount,
              range: plain(summary.linkRangeMetres / 1000, 1),
            })
          }}
        </span>
        {{ t('sightlines.credit') }}
      </p>
    </div>
  </details>
</template>
