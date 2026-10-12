<script setup lang="ts">
  import {
    MARK_LETTER_VIEWBOX,
    WINE_RED,
    WINE_RED_ON_NIGHT,
    buildMarkPaths,
  } from '#shared/utils/brand-mark'

  /**
   * "Vestigian" with its own capital V standing in for the first letter — the
   * header's name, beside the burger menu on both layouts.
   *
   * **Said once, in words.** The visible letters are `aria-hidden` and the name is
   * a `sr-only` span, so a screen reader and `getByRole('link', { name })` read
   * "Vestigian" and not "estigian", and the mark needs no label of its own.
   *
   * **Sized in `em`, so it follows the font.** The caller sets the size and the
   * display face on its own element; the V is 0.7em tall — the cap height of
   * Fraunces as it is set here — and sits on the baseline (its foot is the bottom
   * of the viewBox). The geometry is `shared/utils/brand-mark.ts`, the same that
   * writes the favicon and the share cards.
   *
   * **Two colours, by the colour mode** (`WINE_RED`, `WINE_RED_ON_NIGHT`): the
   * deep wine is 9.5:1 on the light header and 1.6:1 on the night one, where the
   * lighter wine is 5.1:1.
   */
  const paths = buildMarkPaths()
</script>

<template>
  <span class="inline-flex items-baseline">
    <span class="sr-only">Vestigian</span>
    <span aria-hidden="true" class="inline-flex items-baseline">
      <svg
        :viewBox="MARK_LETTER_VIEWBOX"
        :style="{ '--wordmark-wine': WINE_RED, '--wordmark-wine-night': WINE_RED_ON_NIGHT }"
        class="mr-[0.04em] h-[0.7em] w-auto fill-(--wordmark-wine) dark:fill-(--wordmark-wine-night)"
        focusable="false"
      >
        <path v-for="data in paths" :key="data" :d="data" />
      </svg>
      estigian
    </span>
  </span>
</template>
