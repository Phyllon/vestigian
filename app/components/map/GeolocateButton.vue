<script setup lang="ts">
  import type { GeoJSONSource } from 'maplibre-gl'
  import { COMPASS_MOVE_FLAG } from '~/composables/map/useCompassHeading'
  import { buildAccuracyCircle } from '~/composables/map/useGeolocation'

  const { t } = useI18n()
  const map = useMapInstance()
  const { status, position, isFollowing, errorCode, toggleFollow, releaseFollow } = useGeolocation()

  const errorMessage = computed(() =>
    errorCode.value ? t(`geolocate.errors.${errorCode.value}`) : null,
  )

  const POSITION_SOURCE_ID = 'device-position'
  const FOLLOW_MOVE_FLAG = 'geolocateFollow'

  const iconName = computed(() => {
    if (status.value === 'denied' || status.value === 'unavailable') return 'i-lucide-locate-off'
    if (isFollowing.value) return 'i-lucide-locate-fixed'
    return 'i-lucide-locate'
  })

  const buttonLabel = computed(() => {
    if (status.value === 'denied') return t('geolocate.locationBlocked')
    if (isFollowing.value) return t('geolocate.stopFollowing')
    return t('geolocate.showPosition')
  })

  const drawPosition = (): void => {
    const instance = map.value
    const reading = position.value
    if (!instance || !reading || !instance.isStyleLoaded()) return

    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        buildAccuracyCircle(reading.coords, reading.accuracy),
        {
          type: 'Feature',
          properties: { kind: 'point' },
          geometry: { type: 'Point', coordinates: [reading.coords.lon, reading.coords.lat] },
        },
      ],
    }

    const source = instance.getSource(POSITION_SOURCE_ID)
    if (source && 'setData' in source) {
      ;(source as GeoJSONSource).setData(data)
      return
    }

    instance.addSource(POSITION_SOURCE_ID, { type: 'geojson', data })

    instance.addLayer({
      id: 'device-accuracy',
      type: 'fill',
      source: POSITION_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#4a6b5c', 'fill-opacity': 0.14 },
    })

    instance.addLayer({
      id: 'device-point',
      type: 'circle',
      source: POSITION_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 6,
        'circle-color': '#4a6b5c',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#faf7ef',
      },
    })
  }

  watch(position, (reading) => {
    drawPosition()
    if (reading && isFollowing.value) {
      map.value?.easeTo(
        {
          center: [reading.coords.lon, reading.coords.lat],
          zoom: Math.max(map.value.getZoom(), 15),
          duration: 700,
        },
        { [FOLLOW_MOVE_FLAG]: true },
      )
    }
  })

  /**
   * Following ends on any move that is not our own recentring — a drag, wheel,
   * pinch or key press, but also a programmatic jump such as a search result
   * or a picked feature, which would otherwise be undone by the next fix.
   * `easeTo`'s second argument is merged into the `movestart` event it fires
   * synchronously, so our own moves identify themselves by `FOLLOW_MOVE_FLAG`.
   * Turning the map with the compass is not the reader steering it either, and
   * would otherwise end following on the first reading.
   */
  watch(
    map,
    (instance, _previous, onCleanup) => {
      if (!instance) return
      const releaseOnUserMove = (event: object): void => {
        if (!(FOLLOW_MOVE_FLAG in event) && !(COMPASS_MOVE_FLAG in event)) releaseFollow()
      }
      instance.on('movestart', releaseOnUserMove)
      onCleanup(() => instance.off('movestart', releaseOnUserMove))
    },
    { immediate: true },
  )
</script>

<template>
  <div class="flex flex-col items-end gap-2">
    <button
      type="button"
      class="leaf grid size-11 place-items-center transition hover:bg-paper-200 disabled:opacity-50 dark:hover:bg-night-700"
      :class="
        isFollowing
          ? 'text-verdigris-600 dark:text-verdigris-400'
          : 'text-ink-700 dark:text-paper-200'
      "
      :disabled="status === 'unavailable'"
      :aria-pressed="isFollowing"
      :aria-label="buttonLabel"
      :title="buttonLabel"
      @click="toggleFollow"
    >
      <UIcon
        :name="iconName"
        class="size-5"
        :class="status === 'prompting' ? 'animate-pulse' : ''"
      />
    </button>

    <p
      v-if="errorMessage"
      class="leaf max-w-56 px-3 py-2 text-xs text-ink-500 dark:text-paper-400"
      role="status"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
