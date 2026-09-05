<script setup lang="ts">
  import OpenSeadragon from 'openseadragon'
  import type { Viewer } from 'openseadragon'

  /**
   * Petersen, Domaszewski & Calderini, "Die Marcus-Säule auf Piazza Colonna
   * in Rom" (Munich, 1896) — the direct scholarly equivalent, for this
   * column, of Cichorius's plates for Trajan's. Digitised by Heidelberg
   * University Library in two plate volumes; served live via IIIF rather
   * than mirrored, since it's one scanned book, not a bounded file set.
   *
   * Verified live before this was written, not assumed: Heidelberg's own
   * HTML viewer pages sit behind an Anubis bot challenge, but its IIIF API
   * — this manifest, its `info.json`s, and a sample image tile — all
   * answered 200 with real content on a plain, unauthenticated request. See
   * CLAUDE.md's "Column reliefs" section for exactly what was checked.
   *
   * **OpenSeadragon does not consume a IIIF Presentation manifest directly**
   * — confirmed against its own source (`TileSource.determineType` only ever
   * matches a registered `*TileSource` class against the data, and every one
   * of them expects a single IIIF *Image* API `info.json` shape, not a
   * `sc:Manifest`), not merely assumed from general IIIF familiarity. Handing
   * it the manifest URL directly threw "Unable to load tile source" for
   * every canvas — this component instead fetches the manifest itself,
   * resolves each canvas's own Image API service, and hands OpenSeadragon an
   * *array* of `info.json` URLs, which is the shape it actually understands
   * for a multi-page sequence.
   *
   * **Every request goes through this project's own `/api/columns/
   * marcus-aurelius/*` proxy, never straight to Heidelberg.** A real
   * browser's cross-origin `fetch` to `digi.ub.uni-heidelberg.de` fails
   * outright ("Failed to fetch", `net::ERR_FAILED`) even though the same
   * request succeeds from `curl`, from Node, and from a top-level page
   * navigation — reproduced directly in a real Chromium session, not
   * inferred. `server/api/columns/marcus-aurelius/manifest.get.ts` fetches
   * and rewrites the manifest server-side; its own docstring has the full
   * account.
   */
  const VOLUMES = ['tafeln-i-lxiv', 'tafeln-lxv-cxxviii'] as const
  type Volume = (typeof VOLUMES)[number]

  /** Only the shape actually read from a IIIF Presentation API v2 manifest. */
  interface IIIFImageService {
    '@id'?: string
  }

  interface IIIFManifest {
    sequences?: {
      canvases?: {
        images?: {
          resource?: {
            service?: IIIFImageService | IIIFImageService[]
          }
        }[]
      }[]
    }[]
  }

  const { t } = useI18n()

  const activeVolume = ref<Volume>('tafeln-i-lxiv')
  const isLoading = ref(false)
  const loadFailed = ref(false)
  const viewer = useTemplateRef('viewer')
  let osdViewer: Viewer | null = null

  /** A server can describe a canvas's image service as one object or, per
   *  the IIIF spec, an array of them — Heidelberg's manifests use the plain
   *  object form, confirmed by inspecting a real response, but this reads
   *  either without assuming which. */
  const resolveServiceId = (
    service: IIIFImageService | IIIFImageService[] | undefined,
  ): string | null => {
    const entry = Array.isArray(service) ? service[0] : service
    return typeof entry?.['@id'] === 'string' ? entry['@id'] : null
  }

  const buildTileSources = async (volume: Volume): Promise<string[]> => {
    const manifest = await $fetch<IIIFManifest>('/api/columns/marcus-aurelius/manifest', {
      query: { volume },
    })
    const canvases = manifest.sequences?.[0]?.canvases ?? []
    return canvases
      .map((canvas) => resolveServiceId(canvas.images?.[0]?.resource?.service))
      .filter((id): id is string => id !== null)
      .map((id) => `${id}/info.json`)
  }

  /**
   * A fresh viewer per volume rather than `osdViewer.open(sources)`:
   * OpenSeadragon's own `.open()` type signature is narrower than its
   * constructor's `tileSources` option for an array — a gap in the
   * library's own types, not a real restriction — and switching volumes
   * happens rarely enough (one button click) that recreating the viewer
   * costs nothing worth avoiding that gap for.
   */
  const createViewer = async (volume: Volume): Promise<void> => {
    // `.client.vue` components resolve as async components, and their own
    // template ref can still be unset the instant `onMounted` first runs —
    // confirmed directly (see TabulaPeutingerianaViewer.client.vue's own
    // docstring for the full account) on a component with no `await` before
    // this check; the manifest fetch below happens to yield long enough to
    // avoid it in practice, but that's incidental to a network call
    // succeeding quickly, not a real guarantee, so the wait is explicit.
    await nextTick()
    if (!viewer.value) return

    isLoading.value = true
    loadFailed.value = false

    let tileSources: string[]
    try {
      tileSources = await buildTileSources(volume)
      if (tileSources.length === 0) throw new Error('manifest listed no canvases')
    } catch {
      loadFailed.value = true
      isLoading.value = false
      return
    }

    osdViewer = OpenSeadragon({
      element: viewer.value,
      tileSources,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      // No crossOriginPolicy needed — every tile now comes from this
      // project's own `/api/columns/marcus-aurelius/tile/` proxy, same
      // origin as the page itself.
      gestureSettingsTouch: { pinchRotate: false },
      prefixUrl: '/openseadragon/images/',
      // A genuine multi-page sequence (unlike the Tabula Peutingeriana
      // viewer's single image), so the sequence controls turn into a real
      // page-by-page browser through this volume's plates.
      showSequenceControl: true,
      showRotationControl: false,
      showFlipControl: false,
    })
    isLoading.value = false
  }

  const openVolume = (volume: Volume): void => {
    activeVolume.value = volume
    osdViewer?.destroy()
    osdViewer = null
    void createViewer(volume)
  }

  onMounted(() => {
    void createViewer(activeVolume.value)
  })

  onBeforeUnmount(() => {
    osdViewer?.destroy()
    osdViewer = null
  })
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-2" role="group" :aria-label="t('columns.marcusAurelius.volume')">
      <button
        v-for="volume in VOLUMES"
        :key="volume"
        type="button"
        class="rounded-notebook border px-3 py-1.5 text-sm transition"
        :class="
          activeVolume === volume
            ? 'border-oxide-600 bg-oxide-600 text-paper-50'
            : 'border-paper-300 text-ink-700 hover:bg-paper-200 dark:border-night-600 dark:text-paper-200 dark:hover:bg-night-700'
        "
        :aria-pressed="activeVolume === volume"
        @click="openVolume(volume)"
      >
        {{ t(`columns.marcusAurelius.${volume}`) }}
      </button>
    </div>

    <p v-if="isLoading" class="datum mt-4">{{ t('columns.marcusAurelius.loading') }}</p>
    <p v-else-if="loadFailed" class="datum mt-4 text-oxide-600 dark:text-oxide-300">
      {{ t('columns.marcusAurelius.loadFailed') }}
    </p>

    <div
      v-show="!isLoading && !loadFailed"
      ref="viewer"
      class="leaf mt-4 h-[60vh] min-h-80 w-full overflow-hidden"
      role="application"
      :aria-label="t('columns.marcusAurelius.viewerLabel')"
    />
  </div>
</template>
