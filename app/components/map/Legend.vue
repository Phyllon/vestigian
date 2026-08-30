<script setup lang="ts">
  /**
   * The key to the marks on the map, drawn from the same path data the markers
   * are rasterised from, so the two cannot drift apart.
   *
   * Collapsed by default: on a phone the map is the whole screen, and a key
   * that covers a quarter of it to explain nine glyphs is a poor trade until
   * the reader asks for it.
   */
  const { view } = useBasemapStyle()
  const isOpen = ref(false)

  const toggle = (): void => {
    isOpen.value = !isOpen.value
  }
</script>

<template>
  <div class="flex flex-col items-start gap-2">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-1 opacity-0"
      leave-to-class="translate-y-1 opacity-0"
    >
      <div
        v-if="isOpen"
        id="map-legend"
        class="rounded-notebook border border-paper-300 bg-paper-50/95 p-3 shadow-leaf backdrop-blur-sm dark:border-night-600 dark:bg-night-800/95"
      >
        <h2 class="eyebrow mb-2">What the marks mean</h2>

        <ul class="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <li v-for="category in SITE_CATEGORIES" :key="category" class="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              class="h-5 w-5 shrink-0"
              aria-hidden="true"
              fill="none"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle
                cx="12"
                cy="12"
                r="10.4"
                class="fill-paper-50 stroke-paper-500 dark:fill-night-800 dark:stroke-paper-800"
                stroke-width="1"
              />
              <path
                :d="SITE_ICON_PATHS[category]"
                :class="
                  category === 'infrastructure'
                    ? 'stroke-bronze-600 dark:stroke-bronze-300'
                    : 'stroke-ink-800 dark:stroke-paper-200'
                "
              />
            </svg>

            <span class="text-xs text-ink-700 dark:text-paper-200">
              {{ SITE_CATEGORY_LABELS[category] }}
            </span>
          </li>
        </ul>

        <!--
          The antiquity sheet carries twenty-two thousand places borrowed from
          Pleiades alongside the records contributed here, and the borrowed ones
          outnumber them. Same glyphs, drawn without the disc — so the reader can
          tell the atlas from the work without being told twice.
        -->
        <p
          v-if="isAntiquityView(view)"
          class="mt-2.5 max-w-64 border-t border-paper-300 pt-2 text-xs leading-snug text-ink-500 dark:border-night-600 dark:text-paper-400"
        >
          The same marks drawn as thin outlines, without a disc, are places referenced from the
          Barrington Atlas and Pleiades — not records contributed here.
        </p>
      </div>
    </Transition>

    <UButton
      color="neutral"
      variant="outline"
      size="xs"
      icon="i-lucide-key-round"
      class="shadow-leaf"
      :aria-expanded="isOpen"
      aria-controls="map-legend"
      @click="toggle"
    >
      {{ isOpen ? 'Hide key' : 'Key' }}
    </UButton>
  </div>
</template>
