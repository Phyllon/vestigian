<script setup lang="ts">
  import type { LimesInstallation } from '#shared/types'

  /**
   * The frontier, as a thing to be walked.
   *
   * Two states in one panel rather than two panels: the roll of a sector is
   * where the reader ends up and the list of sectors is how they get there, so
   * a back button between them keeps one surface and one scroll position on a
   * phone. Same shell as `SiteDetailPanel` — a sheet on handhelds, a rail on
   * wide screens — because it competes for the same corner of the screen.
   */
  const { t } = useI18n()
  const { sectors, sectorsStatus, sector, sectorStatus, selectedSectorSlug, selectSector } =
    useLimes()
  const { selectSite } = useSiteQuery()
  const { isCompact } = useBreakpoint()
  const map = useMapInstance()

  const isCollapsed = ref(false)

  /**
   * The roll interleaved for reading, while the two halves stay separate in the
   * response.
   *
   * Ordering by distance along the frontier is the entire point — a list that
   * put every contributed record first and every Pleiades place after it would
   * be two lists, not an itinerary. What keeps the licences apart is that each
   * entry still says which it is, and the attribution for both is printed under
   * the list.
   */
  const roll = computed<LimesInstallation[]>(() => {
    if (!sector.value) return []
    return [...sector.value.roll.records, ...sector.value.roll.references].sort(
      (a, b) => a.offsetMetres - b.offsetMetres,
    )
  })

  const focusSector = (slug: string): void => {
    selectSector(slug)
    const found = sectors.value.find((entry) => entry.slug === slug)
    if (!found) return

    /**
     * Padded around the panel, not around the canvas.
     *
     * MapLibre fits to the whole container, and this panel covers most of a
     * phone screen and a third of a wide one — so a plain padding number put
     * the Rhine behind the sheet and left the reader looking at the North Sea.
     */
    const height = map.value?.getContainer().clientHeight ?? 0
    map.value?.fitBounds(
      [
        [found.bounds.west, found.bounds.south],
        [found.bounds.east, found.bounds.north],
      ],
      {
        padding: isCompact.value
          ? { top: 24, right: 24, bottom: Math.round(height * 0.58) + 16, left: 24 }
          : { top: 32, right: 32, bottom: 32, left: 384 },
        duration: 900,
      },
    )
  }

  /**
   * A contributed record opens the panel it already has. A borrowed place has
   * no page here — it is Pleiades' record, not ours — so the map goes to it and
   * the name in the roll is the whole of what this atlas says about it.
   */
  const openInstallation = (installation: LimesInstallation): void => {
    map.value?.flyTo({
      center: [installation.position.lon, installation.position.lat],
      zoom: Math.max(map.value.getZoom(), 13),
      duration: 900,
      essential: true,
    })
    if (installation.slug) selectSite(installation.id)
  }
</script>

<template>
  <!--
    `absolute`, not `fixed`. `fixed` positions against the viewport, and
    `md:inset-y-0` on a fixed element reaches all the way to the browser's own
    top edge — underneath this app's own header (`z-40` in `default.vue`),
    which sits above this panel's `z-20`. The sticky back button and sector
    title in the header just below were being rendered exactly where the app
    header already draws, invisible and unclickable — confirmed live, where
    Playwright reported the click intercepted by the header's own subtree, and
    the only way back to the sector list was switching the frontier off and on
    again. `absolute` positions against `MapCanvas`'s own container instead,
    which is already sized to the space below the header, so `inset-y-0`
    reaches exactly as far as it should. The bottom-sheet layout below `md`
    needed no change: `bottom-0` never intersected the header either way.
  -->
  <aside
    class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-h-[62vh] flex-col rounded-t-lg bg-paper-50 shadow-lifted md:inset-y-0 md:right-auto md:left-0 md:max-h-none md:w-[22rem] md:rounded-none md:border-r md:border-paper-200 dark:bg-night-800 dark:md:border-night-700"
    :aria-label="t('limesPanel.title')"
  >
    <div class="sticky top-0 z-10 shrink-0 bg-paper-50 pt-2 dark:bg-night-800 md:pt-0">
      <div class="mx-auto mb-1 h-1 w-10 rounded-full bg-paper-300 dark:bg-night-600 md:hidden" />
      <div
        class="flex items-center gap-2 border-b border-paper-200 px-5 py-3 dark:border-night-700"
      >
        <UButton
          v-if="selectedSectorSlug"
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          size="xs"
          :aria-label="t('limesPanel.backToFrontier')"
          @click="selectSector(null)"
        />
        <p class="eyebrow">
          {{
            selectedSectorSlug
              ? (sector?.name ?? t('limesPanel.loading'))
              : t('limesPanel.theLimes')
          }}
        </p>

        <UButton
          class="ml-auto"
          :icon="isCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          variant="ghost"
          color="neutral"
          size="xs"
          :aria-expanded="!isCollapsed"
          aria-controls="limes-body"
          :aria-label="isCollapsed ? t('limesPanel.showFrontier') : t('limesPanel.hideFrontier')"
          @click="isCollapsed = !isCollapsed"
        />
      </div>
    </div>

    <div v-show="!isCollapsed" id="limes-body" class="min-h-0 flex-1 overflow-y-auto">
      <!-- The sector list. -->
      <div v-if="!selectedSectorSlug">
        <p class="px-5 py-3 text-sm leading-relaxed text-ink-600 dark:text-paper-300">
          {{ t('limesPanel.introBody') }}
        </p>

        <p
          v-if="sectorsStatus === 'pending'"
          class="px-5 pb-4 text-sm text-ink-500 dark:text-paper-400"
        >
          {{ t('limesPanel.unrolling') }}
        </p>

        <ul v-else class="border-t border-paper-200 dark:border-night-700">
          <li v-for="entry in sectors" :key="entry.slug">
            <button
              type="button"
              class="flex w-full flex-col items-start gap-0.5 border-b border-paper-200 px-5 py-3 text-left transition hover:bg-paper-100 dark:border-night-700 dark:hover:bg-night-700"
              @click="focusSector(entry.slug)"
            >
              <span class="font-medium text-ink-900 dark:text-paper-100">{{ entry.name }}</span>
              <span class="font-mono text-xs text-ink-500 dark:text-paper-400">
                {{ formatFrontierLength(entry.lengthMetres) }} ·
                {{ formatFrontierYears({ from: entry.minYear, to: entry.maxYear, t }) }}
              </span>
            </button>
          </li>
        </ul>
      </div>

      <!-- One sector, and the roll along it. -->
      <div v-else>
        <p
          v-if="sectorStatus === 'pending'"
          class="px-5 py-4 text-sm text-ink-500 dark:text-paper-400"
        >
          {{ t('limesPanel.readingRoll') }}
        </p>

        <template v-else-if="sector">
          <div class="px-5 py-3">
            <p v-if="sector.latinName" class="font-mono text-xs text-ink-500 dark:text-paper-400">
              {{ sector.latinName }}
            </p>
            <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
              {{ sector.summary }}
            </p>
            <p class="mt-2 font-mono text-xs text-ink-500 dark:text-paper-400">
              {{ formatFrontierLength(sector.lengthMetres) }} ·
              {{ formatFrontierYears({ from: sector.minYear, to: sector.maxYear, t }) }} ·
              {{ t('limesPanel.recorded', { count: roll.length }) }}
            </p>
            <NuxtLink
              :to="`/limes/${sector.slug}`"
              class="mt-2 inline-block text-sm text-oxide-700 underline underline-offset-2 dark:text-oxide-300"
            >
              {{ t('limesPanel.readStretch') }}
            </NuxtLink>
          </div>

          <ol class="border-t border-paper-200 dark:border-night-700">
            <li
              v-for="installation in roll"
              :key="`${installation.slug ?? 'p'}-${installation.id}`"
            >
              <button
                type="button"
                class="flex w-full items-start gap-3 border-b border-paper-200 px-5 py-2.5 text-left transition hover:bg-paper-100 dark:border-night-700 dark:hover:bg-night-700"
                @click="openInstallation(installation)"
              >
                <svg
                  class="mt-0.5 size-5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    :d="
                      installation.mark
                        ? LIMES_ICON_PATHS[installation.mark]
                        : SITE_ICON_PATHS.fortification
                    "
                    :stroke="installation.slug ? 'currentColor' : '#8c8271'"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>

                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-sm text-ink-900 dark:text-paper-100">
                    {{ installation.title }}
                  </span>
                  <span class="font-mono text-xs text-ink-500 dark:text-paper-400">
                    {{ formatOffset(installation.offsetMetres, t) }}
                    <template v-if="installation.mark">
                      · {{ t(`limesMarks.${installation.mark}`) }}
                    </template>
                    <template v-if="!installation.slug">
                      · {{ t('limesPanel.referenced') }}
                    </template>
                  </span>
                </span>
              </button>
            </li>
          </ol>

          <!--
            Both attributions, because the roll above interleaves two sources
            with different licences. A reader who cites this list has to be able
            to see which terms apply to which half.
          -->
          <p class="px-5 py-3 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
            {{ sector.roll.recordsAttribution }}. {{ sector.roll.referencesAttribution }}.
          </p>
        </template>
      </div>
    </div>
  </aside>
</template>
