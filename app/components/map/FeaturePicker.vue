<script setup lang="ts">
  import type { SiteCategory } from '#shared/types'
  import type { IconGlyph } from '~/composables/map/useSiteIcons'

  /**
   * What to do when a tap lands on more than one record.
   *
   * Markers are drawn with `icon-allow-overlap` so that nothing is ever hidden
   * from the reader, which means a dense site is a pile and the topmost marker
   * is not the one they aimed at. Rather than guess, the pile is listed: the
   * same glyph they tapped, the title, and how far each record actually sits
   * from the tap. Some of these share a coordinate exactly and cannot be
   * separated by zooming in, so this is the only way to reach the second one.
   *
   * It borrows the detail panel's chrome deliberately — it occupies the same
   * corner and is replaced by the panel once a choice is made, so it should
   * read as the same surface rather than as a popup over the map.
   */
  const { t, te } = useI18n()
  const { overlappingFeatures, isPickerOpen, chooseCandidate, clearSelection } = useSiteQuery()
  const { isCompact } = useBreakpoint()

  /**
   * The same subcategory-first lookup `buildSiteIconExpression` draws on the
   * map itself — without it, a milestone or a museum tapped out of a pile
   * showed the generic infrastructure/other glyph here while the map right
   * behind it already drew the specific mark, the one place a reader could
   * compare the two side by side.
   */
  const iconGlyphFor = (candidate: MapFeatureCandidate): IconGlyph => {
    const mark = resolveSiteMark(candidate.subcategory)
    if (mark) return SITE_MARK_ICON_GLYPHS[mark]
    return SITE_ICON_GLYPHS[candidate.category as SiteCategory] ?? SITE_ICON_GLYPHS.other
  }

  const labelFor = (category: string): string =>
    te(`categories.${category}`) ? t(`categories.${category}`) : t('categories.other')

  /** Rounded hard: a metre of precision here would be false confidence. */
  const distanceLabel = (metres: number | null): string => {
    if (metres === null) return t('featurePicker.alongThisLine')
    if (metres < 5) return t('featurePicker.atThisPoint')
    if (metres < 1000) return t('featurePicker.metresAway', { metres: Math.round(metres / 5) * 5 })
    return t('featurePicker.kilometresAway', { kilometres: (metres / 1000).toFixed(1) })
  }
</script>

<template>
  <Transition
    :enter-active-class="
      isCompact
        ? 'transition-transform duration-300 ease-out'
        : 'transition-all duration-300 ease-out'
    "
    :leave-active-class="
      isCompact
        ? 'transition-transform duration-200 ease-in'
        : 'transition-all duration-200 ease-in'
    "
    :enter-from-class="isCompact ? 'translate-y-full' : 'translate-x-full opacity-0'"
    :leave-to-class="isCompact ? 'translate-y-full' : 'translate-x-full opacity-0'"
  >
    <!--
      `absolute`, not `fixed` — see the same note in `LimesPanel.vue`.
      `md:inset-y-0` on a `fixed` element reaches the browser's own top edge,
      underneath this app's own header; `absolute` positions against
      `MapCanvas`'s container instead, which already excludes it.
    -->
    <aside
      v-if="isPickerOpen"
      class="pointer-events-auto absolute inset-x-0 bottom-0 z-30 max-h-[78vh] overflow-y-auto rounded-t-lg bg-paper-50 shadow-lifted md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-paper-200 dark:bg-night-800 dark:md:border-night-700"
      aria-labelledby="feature-picker-heading"
    >
      <div class="sticky top-0 z-10 bg-paper-50 pt-2 dark:bg-night-800 md:pt-0">
        <div class="mx-auto mb-1 h-1 w-10 rounded-full bg-paper-300 dark:bg-night-600 md:hidden" />
        <div
          class="flex items-start justify-between gap-3 border-b border-paper-200 px-5 py-3 dark:border-night-700"
        >
          <h2 id="feature-picker-heading" class="eyebrow pt-1">
            {{ t('featurePicker.recordsHere', { count: overlappingFeatures.length }) }}
          </h2>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-notebook text-ink-500 transition hover:bg-paper-200 dark:text-paper-400 dark:hover:bg-night-700"
            :aria-label="t('featurePicker.dismiss')"
            @click="clearSelection"
          >
            <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ul class="divide-y divide-paper-200 dark:divide-night-700">
        <li v-for="candidate in overlappingFeatures" :key="`${candidate.kind}-${candidate.id}`">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-paper-100 dark:hover:bg-night-700"
            @click="chooseCandidate(candidate)"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-6 shrink-0"
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
                class="fill-paper-100 stroke-paper-400 dark:fill-night-900 dark:stroke-paper-800"
                stroke-width="1"
              />
              <path
                v-if="iconGlyphFor(candidate).filled"
                :d="iconGlyphFor(candidate).path"
                :transform="`translate(${GAME_ICON_OFFSET} ${GAME_ICON_OFFSET}) scale(${GAME_ICON_SCALE})`"
                class="fill-bronze-600 dark:fill-bronze-300"
              />
              <path
                v-else
                :d="iconGlyphFor(candidate).path"
                :transform="
                  iconGlyphFor(candidate).inset
                    ? `translate(${OUTLINE_INSET_OFFSET} ${OUTLINE_INSET_OFFSET}) scale(${OUTLINE_INSET_SCALE})`
                    : undefined
                "
                vector-effect="non-scaling-stroke"
                class="stroke-bronze-600 dark:stroke-bronze-300"
              />
            </svg>

            <span class="min-w-0 flex-1">
              <span class="block truncate text-[0.95rem] text-ink-900 dark:text-paper-100">
                {{ candidate.title }}
              </span>
              <span class="eyebrow block pt-0.5">
                {{ labelFor(candidate.category) }} · {{ distanceLabel(candidate.distanceMetres) }}
              </span>
            </span>

            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-ink-300 dark:text-paper-600"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </aside>
  </Transition>
</template>
