<script setup lang="ts">
  import type { ColumnReliefPlateSummary } from '#shared/types'

  const { t } = useI18n()
  const { buildCredit } = useImageUrl()

  const {
    data: plates,
    pending,
    error,
  } = await useFetch<ColumnReliefPlateSummary[]>('/api/column-reliefs', {
    query: { monument: 'trajans-column' },
  })

  const openIndex = ref<number | null>(null)
  const modalOpen = ref(false)
  const isZoomed = ref(false)

  const open = (index: number): void => {
    openIndex.value = index
    isZoomed.value = false
    modalOpen.value = true
  }

  const toggleZoom = (): void => {
    isZoomed.value = !isZoomed.value
  }

  const buildPlateUrl = (plate: ColumnReliefPlateSummary, preset: 'thumb' | 'full'): string =>
    `/api/column-reliefs/${plate.id}/${preset}`

  const plateLabel = (plate: ColumnReliefPlateSummary): string =>
    plate.sceneNumber ? t('columns.trajan.scene', { number: plate.sceneNumber }) : plate.title
</script>

<template>
  <div>
    <p v-if="pending" class="datum">{{ t('columns.trajan.loading') }}</p>
    <p v-else-if="error" class="datum text-oxide-600 dark:text-oxide-300">
      {{ t('columns.trajan.loadFailed') }}
    </p>
    <p v-else-if="!plates?.length" class="datum">{{ t('columns.trajan.empty') }}</p>

    <ul
      v-else
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      :aria-label="t('columns.trajan.gridLabel')"
    >
      <li v-for="(plate, index) in plates" :key="plate.id">
        <button
          type="button"
          class="leaf group w-full overflow-hidden p-0 text-left transition hover:shadow-lifted"
          @click="open(index)"
        >
          <img
            :src="buildPlateUrl(plate, 'thumb')"
            :alt="plateLabel(plate)"
            class="aspect-square w-full object-cover"
            loading="lazy"
            decoding="async"
          />
          <span class="block px-2 py-1.5 text-xs text-ink-700 dark:text-paper-200">
            {{ plateLabel(plate) }}
          </span>
        </button>
      </li>
    </ul>

    <!--
      A carousel, not a single-image modal — swiping or the arrow buttons
      move through every plate in order without closing and reopening.
      `UCarousel` (Nuxt UI's embla-carousel-vue wrapper, already a project
      dependency — no new library needed) gives drag/swipe, keyboard
      arrows and the prev/next buttons for free. Only mounted while the
      modal is open (`v-if`), so `start-index` re-applies fresh to
      whichever thumbnail was actually clicked each time, rather than
      needing an imperative `scrollTo` call after the fact.

      The default theme positions the arrows outside the carousel's own
      bounds from the `sm` breakpoint up (`sm:-start-12`/`sm:-end-12`), which
      `UModal`'s content panel clips with its own `overflow-hidden` — the
      arrows rendered cropped in half. `prev`/`next` are overridden to stay
      inside the carousel at every width instead of relying on the modal
      having 3rem of margin around it to spare.
    -->
    <UModal
      v-model:open="modalOpen"
      :title="t('columns.trajan.tabLabel')"
      :ui="{ content: 'max-w-5xl w-[95vw] sm:w-[90vw]' }"
      @update:open="isZoomed = false"
    >
      <template #body>
        <UCarousel
          v-if="plates?.length && openIndex !== null"
          :items="plates"
          :start-index="openIndex"
          arrows
          :ui="{ item: 'basis-full', prev: 'start-2', next: 'end-2' }"
          @select="isZoomed = false"
        >
          <template #default="{ item: plate }">
            <figure>
              <!--
                Zoom is a click/tap toggle rather than pinch or scroll-wheel
                handling: at full zoom the image exceeds its frame and the
                frame scrolls natively (touch-drag, trackpad, scrollbars),
                which needs no custom pointer-tracking code and works the
                same across mouse, trackpad and touch.
              -->
              <div
                class="relative overflow-auto rounded-notebook bg-paper-100 dark:bg-night-800"
                :class="
                  isZoomed
                    ? 'h-[70vh] sm:h-[75vh]'
                    : 'flex h-[70vh] items-center justify-center sm:h-[75vh]'
                "
              >
                <button
                  type="button"
                  class="block"
                  :class="isZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'"
                  :aria-pressed="isZoomed"
                  :aria-label="t(isZoomed ? 'columns.trajan.zoomOut' : 'columns.trajan.zoomIn')"
                  @click="toggleZoom"
                >
                  <img
                    :src="buildPlateUrl(plate, 'full')"
                    :alt="plateLabel(plate)"
                    :class="isZoomed ? 'max-w-none' : 'max-h-full max-w-full object-contain'"
                  />
                </button>
                <UButton
                  :icon="isZoomed ? 'i-lucide-zoom-out' : 'i-lucide-zoom-in'"
                  color="neutral"
                  variant="solid"
                  size="sm"
                  class="absolute bottom-3 end-3"
                  :aria-pressed="isZoomed"
                  :aria-label="t(isZoomed ? 'columns.trajan.zoomOut' : 'columns.trajan.zoomIn')"
                  @click="toggleZoom"
                />
              </div>
              <figcaption class="mt-2 space-y-1">
                <p class="text-sm text-ink-700 dark:text-paper-200">{{ plateLabel(plate) }}</p>
                <p v-if="plate.description" class="text-sm text-ink-600 dark:text-paper-300">
                  {{ plate.description }}
                </p>
                <p class="datum text-[0.6875rem]">{{ buildCredit(plate) }}</p>
              </figcaption>
            </figure>
          </template>
        </UCarousel>
      </template>
    </UModal>
  </div>
</template>
