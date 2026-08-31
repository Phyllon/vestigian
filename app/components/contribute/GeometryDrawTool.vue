<script setup lang="ts">
  import {
    TerraDraw,
    TerraDrawLineStringMode,
    TerraDrawPolygonMode,
    TerraDrawSelectMode,
  } from 'terra-draw'
  import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

  type DrawMode = 'linestring' | 'polygon' | 'select'

  const props = defineProps<{ initialGeometry?: GeoJSON.Geometry }>()
  const emit = defineEmits<{ finished: [geometry: GeoJSON.Geometry] }>()

  const { t } = useI18n()
  const map = useMapInstance()
  const activeMode = ref<DrawMode>('linestring')
  let draw: TerraDraw | null = null

  const modes = computed(() => [
    {
      value: 'linestring' as const,
      label: t('geometryDrawTool.traceLine'),
      icon: 'i-lucide-spline',
    },
    {
      value: 'polygon' as const,
      label: t('geometryDrawTool.outlineArea'),
      icon: 'i-lucide-pentagon',
    },
    {
      value: 'select' as const,
      label: t('geometryDrawTool.adjustPoints'),
      icon: 'i-lucide-mouse-pointer-2',
    },
  ])

  const setMode = (mode: DrawMode): void => {
    activeMode.value = mode
    draw?.setMode(mode)
  }

  const finish = (): void => {
    const snapshot = draw?.getSnapshot() ?? []
    const drawn = snapshot.at(-1)
    if (drawn) emit('finished', drawn.geometry as GeoJSON.Geometry)
  }

  const clear = (): void => {
    draw?.clear()
  }

  onMounted(() => {
    if (!map.value) return

    draw = new TerraDraw({
      // No `lib` here. The adapter took one in 0.x; 1.x resolves MapLibre
      // itself and the built adapter never reads the key, so passing it did
      // nothing but drag the whole maplibre-gl namespace into this component.
      adapter: new TerraDrawMapLibreGLAdapter({ map: map.value }),
      modes: [
        new TerraDrawLineStringMode({
          styles: { lineStringColor: '#9a3b22', lineStringWidth: 3 },
        }),
        new TerraDrawPolygonMode({
          styles: { fillColor: '#9a3b22', fillOpacity: 0.18, outlineColor: '#9a3b22' },
        }),
        new TerraDrawSelectMode({
          flags: {
            linestring: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
            polygon: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
          },
        }),
      ],
    })

    draw.start()

    // An existing shape loads into select mode, so editing starts by adjusting
    // what is there rather than by drawing over the top of it.
    if (props.initialGeometry) {
      draw.addFeatures([
        {
          id: crypto.randomUUID(),
          type: 'Feature',
          geometry: props.initialGeometry as GeoJSON.LineString | GeoJSON.Polygon,
          properties: {
            mode: props.initialGeometry.type === 'Polygon' ? 'polygon' : 'linestring',
          },
        },
      ])
      activeMode.value = 'select'
    }

    draw.setMode(activeMode.value)
  })

  onBeforeUnmount(() => {
    draw?.stop()
    draw = null
  })
</script>

<template>
  <div
    class="leaf flex items-center gap-1 p-1"
    role="toolbar"
    :aria-label="t('geometryDrawTool.toolbarLabel')"
  >
    <!-- Which mode is active is otherwise carried by the fill colour alone. -->
    <button
      v-for="mode in modes"
      :key="mode.value"
      type="button"
      :aria-pressed="activeMode === mode.value"
      class="grid size-9 place-items-center rounded-notebook transition"
      :class="
        activeMode === mode.value
          ? 'bg-oxide-600 text-paper-50'
          : 'text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700'
      "
      :aria-label="mode.label"
      :title="mode.label"
      @click="setMode(mode.value)"
    >
      <UIcon :name="mode.icon" class="size-4" aria-hidden="true" />
    </button>

    <span class="mx-1 h-6 w-px bg-paper-300 dark:bg-night-600" aria-hidden="true" />

    <UButton size="xs" color="primary" @click="finish">{{
      t('geometryDrawTool.useShape')
    }}</UButton>
    <UButton size="xs" variant="ghost" color="neutral" @click="clear">{{
      t('geometryDrawTool.clear')
    }}</UButton>
  </div>
</template>
