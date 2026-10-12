<script setup lang="ts">
  const props = defineProps<{ id: number }>()

  const { t } = useI18n()
  const { distance, metres, gradient } = useTerrainFormat()
  const { profile, isLoading, hasFailed } = useTracingProfile(() => props.id)
  const { probe } = useSightlineOverlay()

  const stats = computed(() => profile.value?.stats ?? null)

  const spacingMetres = computed(() => {
    const current = profile.value
    if (!current || current.distances.length < 2) return 0
    return Math.round(current.stats.lengthMetres / (current.distances.length - 1))
  })

  const net = computed(() => {
    const current = stats.value
    if (!current) return null
    return Math.round(current.endMetres - current.startMetres)
  })

  const netLabel = computed(() => {
    if (net.value === null || net.value === 0) return t('elevationProfile.netLevel')
    const key = net.value < 0 ? 'elevationProfile.netFall' : 'elevationProfile.netRise'
    return t(key, { metres: metres(Math.abs(net.value)) })
  })

  const summary = computed(() => {
    const current = stats.value
    if (!current) return ''
    return t('elevationProfile.chartLabel', {
      length: distance(current.lengthMetres),
      start: metres(current.startMetres),
      end: metres(current.endMetres),
      low: metres(current.lowest.metres),
      high: metres(current.highest.metres),
    })
  })

  /** A cursor on the profile is a dot on the map, when there is a map under it. */
  const showProbe = (index: number | null): void => {
    const current = profile.value
    if (index === null || !current) {
      probe.value = null
      return
    }
    const point = current.path[index]
    probe.value = point ? { lon: point[0], lat: point[1] } : null
  }
</script>

<template>
  <section v-if="isLoading || profile || hasFailed" aria-labelledby="tracing-profile-heading">
    <h2 id="tracing-profile-heading" class="eyebrow">{{ t('elevationProfile.title') }}</h2>

    <div v-if="isLoading" class="mt-2 space-y-2" role="status">
      <span class="sr-only">{{ t('elevationProfile.loading') }}</span>
      <div class="h-28 w-full animate-pulse rounded bg-paper-200 dark:bg-night-700" />
    </div>

    <p v-else-if="hasFailed && !profile" class="mt-2 text-sm text-ink-500 dark:text-paper-400">
      {{ t('elevationProfile.failed') }}
    </p>

    <template v-else-if="profile && stats">
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">{{ netLabel }}</p>

      <TerrainProfileChart
        class="mt-2"
        :distances="profile.distances"
        :elevations="profile.elevations"
        :breaks="profile.breaks"
        :summary="summary"
        :scrub-label="t('elevationProfile.scrubLabel')"
        @scrub="showProbe"
      />

      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt class="eyebrow pt-0.5">{{ t('elevationProfile.statHighest') }}</dt>
        <dd class="datum">
          {{ metres(stats.highest.metres) }}
          <span class="text-ink-500 dark:text-paper-400">
            · {{ t('elevationProfile.atDistance', { distance: distance(stats.highest.atMetres) }) }}
          </span>
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('elevationProfile.statLowest') }}</dt>
        <dd class="datum">
          {{ metres(stats.lowest.metres) }}
          <span class="text-ink-500 dark:text-paper-400">
            · {{ t('elevationProfile.atDistance', { distance: distance(stats.lowest.atMetres) }) }}
          </span>
        </dd>

        <dt class="eyebrow pt-0.5">{{ t('elevationProfile.statClimb') }}</dt>
        <dd class="datum">{{ metres(stats.ascentMetres) }}</dd>

        <dt class="eyebrow pt-0.5">{{ t('elevationProfile.statDescent') }}</dt>
        <dd class="datum">{{ metres(stats.descentMetres) }}</dd>

        <dt class="eyebrow pt-0.5">{{ t('elevationProfile.statAverage') }}</dt>
        <dd class="datum">{{ gradient(stats.averageGradientPercent) }}</dd>

        <dt class="eyebrow pt-0.5">{{ t('elevationProfile.statSteepest') }}</dt>
        <dd class="datum">
          {{ gradient(stats.steepestGradientPercent) }}
          <span class="text-ink-500 dark:text-paper-400">
            ·
            {{
              t('elevationProfile.steepestWhere', {
                window: distance(stats.gradientWindowMetres),
                distance: distance(stats.steepestAtMetres),
              })
            }}
          </span>
        </dd>
      </dl>

      <p class="mt-3 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
        <span v-if="spacingMetres > 100">
          {{ t('elevationProfile.spacing', { metres: distance(spacingMetres) }) }}
        </span>
        {{ t('elevationProfile.note') }}
        <span v-if="profile.terrainCoverage < 1">
          {{ t('elevationProfile.partial') }}
        </span>
      </p>
    </template>
  </section>
</template>
