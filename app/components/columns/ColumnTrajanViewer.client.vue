<script setup lang="ts">
  import OpenSeadragon from 'openseadragon'
  import type { Options, Viewer } from 'openseadragon'
  import type { ColumnReliefPlateSummary } from '#shared/types'

  /**
   * The Cichorius plates, read one at a time — OpenSeadragon in `sequenceMode`
   * over the whole set, replacing a `UCarousel` of `<img>` elements in a
   * scrollable frame.
   *
   * **The frame it replaces failed on every count a zoomable image has to get
   * right**, which is why an earlier note in `.claude/rules/column-reliefs.md`
   * arguing "native scrolling buys everything a real zoomer would" is wrong
   * and has been corrected there:
   *
   * - The plate was cropped at rest and the panel grew its own scrollbar,
   *   because the image, its caption and the modal's own chrome were three
   *   independently-sized things competing for one fixed height.
   * - Zoom went to the top-left corner every time. `overflow-auto` starts at
   *   scroll origin; there is no "zoom about the pointer" in native
   *   scrolling, and clicking a detail on the right of a plate threw the
   *   reader to the opposite corner of it.
   * - Panning meant the scrollbars. A drag inside the frame did nothing on a
   *   mouse — native drag-scroll is touch-only — so on the desktop where the
   *   detail is actually legible there was no way to move around a zoomed
   *   plate at all.
   * - The carousel's arrows were clipped by `UModal`'s `overflow-hidden`,
   *   patched once by repositioning them, and clipped again as soon as the
   *   frame grew.
   *
   * OpenSeadragon answers all four for free, is already a dependency (the
   * Marcus Aurelius and Tabula Peutingeriana viewers), and draws its own
   * controls *inside* its canvas, so nothing can clip them. This is the
   * project convention working as intended — reach for the established
   * component rather than hand-rolling pointer maths.
   *
   * `type: 'image'` tile sources, not IIIF: unlike the Marcus volumes there is
   * no deep-zoom pyramid behind these — one mirrored JPEG per plate, served
   * through `/api/column-reliefs/:id/full`. OpenSeadragon builds its own
   * downsampled levels from the loaded image, which it does with `drawImage`
   * only (checked in OpenSeadragon 6's `ImageTileSource._buildLevels` — no
   * `toDataURL`, no `getImageData`), so the cross-origin redirect to imgproxy
   * taints the canvas harmlessly rather than throwing a `SecurityError`. No
   * `crossOriginPolicy` is set for that reason; setting one would require
   * CORS headers from imgproxy that this deployment does not send.
   *
   * `.client.vue`, like the other two viewers: OpenSeadragon touches `window`
   * at import time and has no business in the server bundle.
   */
  interface Props {
    plates: ColumnReliefPlateSummary[]
    startIndex: number
  }

  const { plates, startIndex } = defineProps<Props>()

  const { t } = useI18n()
  const { buildCredit } = useImageUrl()

  const currentPage = ref(startIndex)
  const failedToOpen = ref(false)
  const viewer = useTemplateRef('viewer')
  let osdViewer: Viewer | null = null
  let resizeObserver: ResizeObserver | null = null

  const currentPlate = computed<ColumnReliefPlateSummary | null>(
    () => plates[currentPage.value] ?? null,
  )

  const plateLabel = (plate: ColumnReliefPlateSummary): string =>
    plate.sceneNumber ? t('columns.trajan.scene', { number: plate.sceneNumber }) : plate.title

  const goToPlate = (page: number): void => {
    osdViewer?.goToPage(page)
  }

  /**
   * OpenSeadragon's own types admit `{ type: 'image', url }` for a *single*
   * tile source but narrow the array form to `string | TileSource |
   * { type: 'openstreetmaps' }` — a gap in the published types, not a real
   * restriction (the runtime hands each array entry to the same
   * `TileSource.determineType` the single form uses). The same class of gap
   * as `.open()`'s array signature, documented in the Marcus viewer.
   */
  const buildTileSources = (): Options['tileSources'] =>
    plates.map((plate) => ({
      type: 'image',
      url: `/api/column-reliefs/${plate.id}/full`,
    })) as unknown as Options['tileSources']

  const createViewer = async (): Promise<void> => {
    if (plates.length === 0) return

    // Not a bare `await nextTick()`: a single tick is not enough for a
    // `.client.vue` component's own ref inside a modal that mounts its content
    // on open, and this viewer intermittently initialised into nothing at all
    // because of it. The wait is also for a *laid-out* element, because
    // OpenSeadragon reads its home bounds from the container's measurements —
    // see `waitForLaidOutElement`.
    const element = await waitForLaidOutElement({ read: () => viewer.value })
    if (!element) {
      failedToOpen.value = true
      return
    }

    osdViewer = OpenSeadragon({
      element,
      tileSources: buildTileSources(),
      // Without this, an array of tile sources opens every plate at once as
      // stacked images in one world rather than paginating — see
      // `ColumnMarcusAureliusViewer.client.vue`, where that cost a full tile
      // pyramid per plate on every open.
      sequenceMode: true,
      drawer: 'canvas',
      initialPage: startIndex,
      // The grid behind this modal already is the reference strip, and one
      // here would load every plate's image to build its thumbnails.
      showReferenceStrip: false,
      showSequenceControl: true,
      showNavigator: false,
      showRotationControl: false,
      showFlipControl: false,
      // **Deliberately off, and it must stay off while this viewer lives in a
      // modal.** `setFullPage(true)` hides every child of `document.body` and
      // moves the viewer element out to the body; only `setFullPage(false)`
      // puts them back. Anything that unmounts this component while full-page
      // is active — closing the modal, Escape, a route change — destroys the
      // one element that knew how to restore the page, leaving the entire
      // application hidden with no way back. `releaseFullPage` below is the
      // belt to this brace. The modal is already the enlarged view, so nothing
      // is lost by removing the control.
      showFullPageControl: false,
      gestureSettingsTouch: { pinchRotate: false },
      // Double-click and pinch both zoom about the point they happened at;
      // this makes a single click do the same, which is the gesture the old
      // frame's click-to-toggle taught readers to expect.
      gestureSettingsMouse: { clickToZoom: true, dblClickToZoom: false },
      prefixUrl: '/openseadragon/images/',
    })

    osdViewer.addHandler('page', (event) => {
      currentPage.value = event.page
    })

    /**
     * A plate that has opened is not necessarily a plate that has been
     * painted: the canvas can hold the previous frame until something
     * perturbs the viewer, which is why a plate would appear only once the
     * reader scrolled or zoomed. Forcing one redraw on the frame after each
     * open costs nothing and removes the reader's part in it.
     */
    osdViewer.addHandler('open', () => {
      requestAnimationFrame(() => osdViewer?.forceRedraw())
    })

    // The same recovery the reader was performing by hand. A modal that
    // settles into its final size after the viewer was built, or a window
    // resize, both land here.
    resizeObserver = new ResizeObserver(() => osdViewer?.forceRedraw())
    resizeObserver.observe(element)
  }

  onMounted(() => {
    void createViewer()
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    releaseFullPage(osdViewer)
    osdViewer?.destroy()
    osdViewer = null
  })
</script>

<template>
  <figure>
    <p v-if="failedToOpen" class="datum text-oxide-600 dark:text-oxide-300">
      {{ t('columns.trajan.loadFailed') }}
    </p>
    <div
      ref="viewer"
      class="h-[55vh] w-full rounded-notebook bg-paper-100 sm:h-[62vh] dark:bg-night-800"
      role="application"
      :aria-label="t('columns.trajan.viewerLabel')"
    />

    <ColumnsColumnPlatePager
      class="mt-3"
      :page="currentPage"
      :total="plates.length"
      @update:page="goToPlate"
    />

    <figcaption v-if="currentPlate" class="mt-2 space-y-1">
      <p class="text-sm text-ink-700 dark:text-paper-200">{{ plateLabel(currentPlate) }}</p>
      <p v-if="currentPlate.description" class="text-sm text-ink-600 dark:text-paper-300">
        {{ currentPlate.description }}
      </p>
      <p class="datum text-[0.6875rem]">{{ buildCredit(currentPlate) }}</p>
    </figcaption>
  </figure>
</template>
