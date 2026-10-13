<script setup lang="ts">
  import { ScaleControl } from 'maplibre-gl'

  /**
   * The distance bar: a length in kilometres or metres that follows the zoom
   * and the latitude, so a reader can judge how far apart two marks are.
   *
   * MapLibre's own `ScaleControl` does the arithmetic (Web Mercator, rounded to
   * 1/2/5 × 10ⁿ, in metres below a kilometre) and is not rewritten here. What
   * it cannot do is stay clear of this app's other controls: added through
   * `map.addControl` it lands in the canvas's bottom-left corner, which is where
   * the key button already sits. It is mounted by hand into this component's own
   * element instead — `onAdd` returns the node and keeps updating it on `move` —
   * so the page decides where it goes (beside the key, see `Legend.vue`'s
   * `beside` slot, which already steps clear of the frontier panel).
   *
   * Metric in every language: all six interface languages are read in countries
   * that use it, and a map of the Roman frontier is not drawn in miles.
   */
  const SCALE_MAX_WIDTH_PIXELS = 96

  const { t } = useI18n()
  const map = useMapInstance()
  const host = useTemplateRef<HTMLDivElement>('host')

  watch(
    () => [map.value, host.value] as const,
    ([instance, container], _previous, onCleanup) => {
      if (!instance || !container) return
      const control = new ScaleControl({ maxWidth: SCALE_MAX_WIDTH_PIXELS, unit: 'metric' })
      container.append(control.onAdd(instance))
      onCleanup(() => control.onRemove())
    },
    { immediate: true },
  )
</script>

<template>
  <div ref="host" class="pb-0.5" role="group" :aria-label="t('mapCanvas.scaleLabel')" />
</template>
