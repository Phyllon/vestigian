<script setup lang="ts">
  import type { SiteCategory } from '#shared/types'
  import { SITE_TYPE_GROUPS } from '#shared/utils/site-type-filter'
  import {
    GAME_ICON_OFFSET,
    GAME_ICON_SCALE,
    OUTLINE_INSET_OFFSET,
    OUTLINE_INSET_SCALE,
    SITE_ICON_GLYPHS,
  } from '~/composables/map/useSiteIcons'

  /**
   * Narrows the sites on the map to the kinds the reader picks — "only
   * temples", "only roads and bridges". It is its own control rather than a row
   * among the overlays: an overlay adds a layer, this changes which of the
   * sites already drawn are shown, and it only means anything while that layer
   * is on (`pages/index.vue` mounts it then).
   *
   * Sits in the thumb-reach column beside the settings gear, not in the row of
   * buttons along the top: that row is already search plus three menus, and a
   * fourth would take a phone's search field down to a sliver.
   *
   * Nothing chosen means everything is shown, so the panel is something a
   * reader adds to, not a list of switches that all start on. Each category is
   * a heading with its kinds as toggle chips under it, and "All"/"None" on the
   * heading for the common case of wanting one whole group. The chips are plain
   * `aria-pressed` buttons, as the compass and locate buttons are, and say they
   * are chosen with a tick as well as a colour.
   *
   * What a selection means, and the filters it becomes, is in
   * `shared/utils/site-type-filter.ts`; how the map uses it is in
   * `useViewportTiles`. Not remembered across visits — see `useSiteTypeFilter`.
   */
  const { isFiltering, selectedCount, getSelectedSubtypes, setSubtypes, clear } =
    useSiteTypeFilter()
  const { t } = useI18n()

  const isOpen = ref(false)

  /**
   * A frame and a dot on the button from the moment the sites are drawn until
   * the reader opens it in this page load. The control appears in the middle of
   * a column of familiar ones when "Sites" is switched on, and nothing else says
   * it is there. Not stored: a one-off remembered across visits was tried and
   * meant the hint was gone for good after a single look, including for a reader
   * who had opened it only to see what it was. Held back while a filter is held,
   * when the count says more.
   */
  const hasOpened = useState<boolean>('site-type-filter-opened', () => false)
  const hasHint = computed(() => !hasOpened.value && !isOpen.value && !isFiltering.value)

  const totalSubtypeCount = SITE_TYPE_GROUPS.reduce(
    (total, group) => total + group.subtypes.length,
    0,
  )

  const triggerLabel = computed(() => {
    if (isFiltering.value) return t('siteTypeFilter.labelActive', { count: selectedCount.value })
    return hasHint.value ? t('siteTypeFilter.labelWithNew') : t('siteTypeFilter.label')
  })

  const statusLabel = computed(() =>
    isFiltering.value
      ? t('siteTypeFilter.statusFiltered', { count: selectedCount.value, total: totalSubtypeCount })
      : t('siteTypeFilter.statusAll'),
  )

  const isSubtypeChosen = (category: SiteCategory, subtype: string): boolean =>
    getSelectedSubtypes(category).includes(subtype)

  const toggleSubtype = (category: SiteCategory, subtype: string): void => {
    const chosen = getSelectedSubtypes(category)
    setSubtypes(
      category,
      chosen.includes(subtype) ? chosen.filter((kind) => kind !== subtype) : [...chosen, subtype],
    )
  }

  const isCategoryComplete = (category: SiteCategory, subtypes: readonly string[]): boolean =>
    getSelectedSubtypes(category).length === subtypes.length

  const toggleCategory = (category: SiteCategory, subtypes: readonly string[]): void => {
    setSubtypes(category, isCategoryComplete(category, subtypes) ? [] : subtypes)
  }

  const categoryName = (category: SiteCategory): string => t(`categories.${category}`)

  const popoverContent = { side: 'left', align: 'end', sideOffset: 8 } as const

  watch(isOpen, (open) => {
    if (open) hasOpened.value = true
  })
</script>

<template>
  <UPopover
    v-model:open="isOpen"
    :content="popoverContent"
    :ui="{
      content:
        'z-40 max-h-[min(70dvh,36rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--radius-notebook)] border border-paper-300 bg-[var(--surface-raised)] shadow-[var(--shadow-lifted)] ring-0 dark:border-night-600',
    }"
  >
    <button
      type="button"
      class="leaf relative grid size-11 place-items-center text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :class="hasHint ? 'outline-2 outline-offset-2 outline-oxide-600 dark:outline-oxide-300' : ''"
      :aria-label="triggerLabel"
      :title="triggerLabel"
    >
      <UIcon name="i-lucide-list-filter" class="size-5" aria-hidden="true" />
      <!--
        The count is on the button because, with the panel shut, nothing else
        says that some sites are being left out of the map — the same reason the
        overlay menu's button carries one. A number, so it is not only a colour.
      -->
      <!--
        The frame is an outline, not a ring: `.leaf` owns `box-shadow`, and a
        ring would fight it. The dot is the shape for anyone who cannot tell the
        colour; the label above says it in words.
      -->
      <span
        v-if="hasHint"
        class="absolute -right-1 -top-1 size-3 rounded-full bg-oxide-600 ring-2 ring-[var(--surface-raised)] dark:bg-oxide-300"
        aria-hidden="true"
      />
      <span
        v-if="isFiltering"
        class="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-ink-800 px-1 font-mono text-[0.7rem] leading-5 text-paper-50 ring-2 ring-[var(--surface-raised)] dark:bg-paper-100 dark:text-night-900"
        aria-hidden="true"
      >
        {{ selectedCount }}
      </span>
    </button>

    <template #content>
      <div
        class="sticky top-0 z-10 border-b border-paper-200 bg-[var(--surface-raised)] px-4 pb-2 pt-3 dark:border-night-700"
      >
        <div class="flex items-center justify-between gap-2">
          <h2 class="eyebrow">{{ t('siteTypeFilter.title') }}</h2>
          <button
            type="button"
            class="inline-flex min-h-8 items-center gap-1 rounded-notebook px-2 text-xs text-ink-700 transition hover:bg-paper-200 disabled:pointer-events-none disabled:opacity-40 dark:text-paper-200 dark:hover:bg-night-700"
            :disabled="!isFiltering"
            @click="clear"
          >
            <UIcon name="i-lucide-x" class="size-3.5" aria-hidden="true" />
            {{ t('siteTypeFilter.clear') }}
          </button>
        </div>
        <!-- Announced as it changes: the reader is operating chips, not looking at this line. -->
        <p class="mt-1 text-xs leading-snug text-ink-500 dark:text-paper-400" role="status">
          {{ statusLabel }}
        </p>
      </div>

      <div class="space-y-4 px-4 py-3">
        <section
          v-for="group in SITE_TYPE_GROUPS"
          :key="group.category"
          :aria-labelledby="`site-type-${group.category}`"
        >
          <div class="mb-1.5 flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              class="size-5 shrink-0"
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
                v-if="SITE_ICON_GLYPHS[group.category].filled"
                :d="SITE_ICON_GLYPHS[group.category].path"
                :transform="`translate(${GAME_ICON_OFFSET} ${GAME_ICON_OFFSET}) scale(${GAME_ICON_SCALE})`"
                class="fill-bronze-600 dark:fill-bronze-300"
              />
              <path
                v-else
                :d="SITE_ICON_GLYPHS[group.category].path"
                :transform="
                  SITE_ICON_GLYPHS[group.category].inset
                    ? `translate(${OUTLINE_INSET_OFFSET} ${OUTLINE_INSET_OFFSET}) scale(${OUTLINE_INSET_SCALE})`
                    : undefined
                "
                vector-effect="non-scaling-stroke"
                class="stroke-bronze-600 dark:stroke-bronze-300"
              />
            </svg>

            <h3
              :id="`site-type-${group.category}`"
              class="min-w-0 flex-1 truncate text-sm font-medium text-ink-900 dark:text-paper-100"
            >
              {{ categoryName(group.category) }}
            </h3>

            <button
              v-if="group.subtypes.length > 1"
              type="button"
              class="min-h-8 shrink-0 rounded-notebook px-2 text-xs text-ink-700 underline decoration-paper-400 underline-offset-2 transition hover:bg-paper-200 dark:text-paper-200 dark:decoration-paper-600 dark:hover:bg-night-700"
              :aria-label="
                isCategoryComplete(group.category, group.subtypes)
                  ? t('siteTypeFilter.clearCategory', { category: categoryName(group.category) })
                  : t('siteTypeFilter.selectCategory', { category: categoryName(group.category) })
              "
              @click="toggleCategory(group.category, group.subtypes)"
            >
              {{
                isCategoryComplete(group.category, group.subtypes)
                  ? t('siteTypeFilter.none')
                  : t('siteTypeFilter.all')
              }}
            </button>
          </div>

          <ul class="flex flex-wrap gap-1.5">
            <li v-for="subtype in group.subtypes" :key="subtype">
              <button
                type="button"
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition"
                :class="
                  isSubtypeChosen(group.category, subtype)
                    ? 'border-bronze-600 bg-bronze-100 text-ink-900 dark:border-bronze-300 dark:bg-bronze-800 dark:text-paper-100'
                    : 'border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200 dark:border-night-600 dark:bg-night-800 dark:text-paper-200 dark:hover:bg-night-700'
                "
                :aria-pressed="isSubtypeChosen(group.category, subtype)"
                @click="toggleSubtype(group.category, subtype)"
              >
                <UIcon
                  v-if="isSubtypeChosen(group.category, subtype)"
                  name="i-lucide-check"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {{ t(`siteTypeFilter.subtypes.${subtype}`) }}
              </button>
            </li>
          </ul>
        </section>

        <p
          v-if="isFiltering"
          class="border-t border-paper-200 pt-3 text-xs leading-snug text-ink-500 dark:border-night-700 dark:text-paper-400"
        >
          {{ t('siteTypeFilter.individualMarkers') }}
        </p>
      </div>
    </template>
  </UPopover>
</template>
