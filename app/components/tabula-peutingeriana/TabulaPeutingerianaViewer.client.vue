<script setup lang="ts">
  import OpenSeadragon from 'openseadragon'
  import type { Viewer } from 'openseadragon'

  /**
   * The Tabula Peutingeriana's deep-zoom viewer, extracted into its own
   * `.client.vue` component rather than living inline in the page.
   *
   * OpenSeadragon touches `document` at module import time, not only inside
   * onMounted — a direct request/hard reload of `/tabula-peutingeriana`
   * crashed with a 500 ("document is not defined") the moment Nitro's SSR
   * pass required this module, regardless of the page's own `ssr: false`:
   * that flag skips *rendering* the page server-side, but Nitro's server
   * bundle still needs to resolve every component the page's template
   * references, which still executes this module's top-level `import`.
   * The `.client.vue` filename suffix is what actually excludes a
   * component's real module from the server bundle (Nuxt swaps in a stub),
   * not `ssr: false` alone — found by reloading the page for real, not by
   * reasoning about the code, the same way the two bugs below were found.
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
   * still code-splits this component's own chunk normally with a static
   * import; only the redundant dynamic-import indirection was the problem.
   */
  const { t } = useI18n()

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

  /**
   * `await nextTick()` before touching `viewer.value` — not a defensive
   * habit, a real fix. A `.client.vue` component is resolved by Nuxt as an
   * async component (that's what lets it be excluded from the server
   * bundle), and `onMounted` on an async-resolved component can fire before
   * its own template ref has actually been attached to the committed DOM,
   * unlike a normally-resolved component where a ref is guaranteed set
   * before `onMounted` runs. `viewer.value` read straight away was reliably
   * `null` here — confirmed by logging it directly in a real browser, not
   * assumed — and the viewer silently never constructed, the same "no
   * thrown error, no network request" silence the two bugs below produce.
   * One microtask tick is enough; nothing here needs a longer wait.
   */
  onMounted(async () => {
    await nextTick()
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
      // There is exactly one tile source here, never a sequence, and rotation
      // and flip controls were already off by these defaults — made explicit
      // so the toolbar this page actually shows (zoom in/out, home, fullpage)
      // is a decision recorded here rather than an accident of OpenSeadragon's
      // defaults. `showSequenceControl` is the one that matters: left at its
      // default `true`, it constructs a disabled previous/next pair regardless
      // of `sequenceMode`, which both clutters the toolbar with two buttons
      // that can never do anything on a single-image viewer and requests four
      // PNGs this page has nothing to show them for.
      showSequenceControl: false,
      showRotationControl: false,
      showFlipControl: false,
    })
  })

  onBeforeUnmount(() => {
    osdViewer?.destroy()
    osdViewer = null
  })
</script>

<template>
  <div
    ref="viewer"
    class="leaf mx-auto h-[60vh] min-h-80 w-full max-w-6xl overflow-hidden"
    role="application"
    :aria-label="t('tabulaPeutingeriana.viewerLabel')"
  />
</template>
