<script setup lang="ts">
  import OpenSeadragon from 'openseadragon'
  import type { Viewer } from 'openseadragon'

  /**
   * A standalone IIIF deep-zoom viewer, not a fifth basemap.
   *
   * The Tabula Peutingeriana is a schematic route diagram — 113,664×6,144px,
   * 18.5:1 — not a geographically accurate map. Draping it as a MapLibre
   * raster source under real site markers the way DARE or the satellite view
   * are would misplace every road relative to the coordinates it sits beside,
   * so it gets its own page and its own viewer instead.
   *
   * The tile source is René Voorburg's IIIF Image API v3 service
   * (`iiif.omnesviae.org`), the same person this project already has a
   * courtesy-contact relationship with for image mirroring (see CLAUDE.md).
   * Unlike DARE or the satellite pyramid, this is one manuscript scan, not a
   * continent's worth of tiles — there is no mirror-URL fallback here because
   * there is nothing at that scale to justify pre-building one.
   */
  const IIIF_INFO_URL = 'https://iiif.omnesviae.org/iiif/peutinger.tiff/info.json'

  /**
   * A static top-level import, not a dynamic one — matching how `maplibre-gl`
   * is imported elsewhere in this app (`useMapInstance.ts`). A dynamic
   * `import('openseadragon')` here went through Rollup's generated
   * CJS-default-interop wrapper for the split chunk and came back `undefined`
   * for a default export that is itself a callable function with static
   * properties (`OpenSeadragon.Viewer`, …) rather than a plain object — the
   * viewer silently constructed nothing, with no thrown error and no network
   * request, found only by inspecting the compiled chunk directly. Rollup
   * still code-splits this page's own chunk normally with a static import;
   * only the redundant dynamic-import indirection was the problem.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  useHead({ title: t('tabulaPeutingeriana.title') })
  useSeoMeta({ description: t('tabulaPeutingeriana.intro') })
  useCanonicalUrl()
  useSocialMeta({
    title: t('tabulaPeutingeriana.title'),
    description: t('tabulaPeutingeriana.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })

  /**
   * Named `viewer`, matching the template's `ref="viewer"` exactly — Vue's
   * compiler wires an SFC `ref` string to whichever script-setup binding is
   * literally named that, not to whatever a `useTemplateRef` call happens to
   * be assigned to. A once-tried `const viewerElement = useTemplateRef('viewer')`
   * left the template's `ref="viewer"` binding nothing at all (it bound
   * instead to a same-named local further down), so `viewer.value` was
   * always null and the deep-zoom viewer silently never constructed — no
   * thrown error, no network request, found only by inspecting the compiled
   * render function.
   */
  const viewer = useTemplateRef('viewer')
  let osdViewer: Viewer | null = null

  onMounted(() => {
    if (!viewer.value) return

    osdViewer = OpenSeadragon({
      element: viewer.value,
      tileSources: IIIF_INFO_URL,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      crossOriginPolicy: 'Anonymous',
      gestureSettingsTouch: { pinchRotate: false },
      // Self-hosted, matching every other asset in this app (fonts, label
      // glyphs): OpenSeadragon's default `prefixUrl` resolves against its own
      // script location, which is meaningless once bundled — left unset, its
      // zoom/home/fullscreen buttons 404 against `/images/*.png` at this
      // app's own root. The PNGs are vendored from the installed package
      // (New BSD, same as the library) into `public/openseadragon/images/`.
      prefixUrl: '/openseadragon/images/',
    })
  })

  onBeforeUnmount(() => {
    osdViewer?.destroy()
    osdViewer = null
  })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('tabulaPeutingeriana.title') }}
    </h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('tabulaPeutingeriana.intro') }}
    </p>

    <p class="mt-2 text-sm leading-relaxed text-ink-500 dark:text-paper-400">
      {{ t('tabulaPeutingeriana.distortionNote') }}
    </p>

    <!-- Breaks out of the reading layout's max-w-3xl prose column: a deep-zoom
         viewer for an 18.5:1 image needs real width, not a column meant for text. -->
    <div class="relative left-1/2 right-1/2 mx-[-50vw] mt-6 w-screen px-4 sm:px-6">
      <div
        ref="viewer"
        class="leaf mx-auto h-[60vh] min-h-80 w-full max-w-6xl overflow-hidden"
        role="application"
        :aria-label="t('tabulaPeutingeriana.viewerLabel')"
      />
    </div>

    <p class="mt-6 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
      {{ t('tabulaPeutingeriana.attribution') }}
      <a
        href="https://omnesviae.org/tabula"
        target="_blank"
        rel="noopener"
        class="underline hover:text-oxide-600 dark:hover:text-oxide-300"
      >
        omnesviae.org
      </a>
    </p>
  </article>
</template>
