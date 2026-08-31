<script setup lang="ts">
  /**
   * The key to the marks on the map, drawn from the same path data the markers
   * are rasterised from, so the two cannot drift apart.
   *
   * Collapsed by default: on a phone the map is the whole screen, and a key
   * that covers a quarter of it to explain nine glyphs is a poor trade until
   * the reader asks for it.
   */
  const { view, isFollowingLimes } = useBasemapStyle()
  const { t } = useI18n()
  const isOpen = ref(false)

  /**
   * The three line treatments, kept beside the paths they describe rather than
   * imported from the style: these are eight-pixel swatches on a legend, not
   * the map's own dash arrays, and matching them exactly would make the key
   * unreadable at this size.
   */
  const LIMES_LINE_KEY = [
    { kind: 'barrier', label: 'Wall, rampart or ditch', dashes: 'none' },
    { kind: 'river', label: 'River frontier, held from the bank', dashes: '7 3' },
    { kind: 'notional', label: 'Frontier without built works', dashes: '3 2.5' },
  ]

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
        <h2 class="eyebrow mb-2">{{ t('legend.title') }}</h2>

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
          {{ t('legend.referencedNote') }}
        </p>

        <!--
          Basemap credit, per layer — DARE's own terms require attribution and
          a link, and neither AWMC (ODbL) nor Pleiades (CC BY) is used without
          one either. See /licence for the full terms.
        -->
        <p
          v-if="view === 'antiquity-dare'"
          class="mt-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400"
        >
          {{ t('legend.basemapCreditDare') }}
          <a
            href="https://dh.gu.se/geography/imperium/"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
          >
            dh.gu.se
          </a>
        </p>
        <p
          v-else-if="view === 'antiquity-awmc'"
          class="mt-2 max-w-64 text-xs leading-snug text-ink-500 dark:text-paper-400"
        >
          {{ t('legend.basemapCreditBarrington') }}
        </p>

        <!--
          The frontier's own key, added rather than substituted: the note above
          is still true while it is showing, and the plans below replace the
          crenellation only for fortifications on the line.
        -->
        <template v-if="isFollowingLimes">
          <h2 class="eyebrow mb-2 mt-3 border-t border-paper-300 pt-2.5 dark:border-night-600">
            {{ t('legend.frontierTitle') }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <li v-for="line in LIMES_LINE_KEY" :key="line.kind" class="flex items-center gap-2">
              <svg class="h-2 w-8 shrink-0" viewBox="0 0 32 8" aria-hidden="true">
                <path
                  d="M0 4h32"
                  stroke="#9a3b22"
                  stroke-width="2.5"
                  :stroke-dasharray="line.dashes"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">{{ line.label }}</span>
            </li>
          </ul>

          <ul class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <li v-for="mark in LIMES_MARKS" :key="mark" class="flex items-center gap-2">
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  :d="LIMES_ICON_PATHS[mark]"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-xs text-ink-700 dark:text-paper-200">
                {{ LIMES_MARK_LABELS[mark] }}
              </span>
            </li>
          </ul>
        </template>
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
      {{ isOpen ? t('legend.hideKey') : t('legend.showKey') }}
    </UButton>
  </div>
</template>
