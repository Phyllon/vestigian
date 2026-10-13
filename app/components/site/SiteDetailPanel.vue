<script setup lang="ts">
  const {
    site,
    status,
    selectSite,
    selectedSiteId,
    isPanelOpen,
    overlappingFeatures,
    hasOverlappingFeatures,
    returnToOverlappingFeatures,
  } = useSiteQuery()
  const { enrichment, isLoadingEnrichment } = useSiteEnrichment()
  const { loggedIn } = useSession()
  const { isCompact } = useBreakpoint()
  const { t, te, locale } = useI18n()

  const panel = useTemplateRef<HTMLElement>('panel')
  const handle = useTemplateRef<HTMLElement>('handle')

  // Matches `max-h-[78dvh]` on the aside — and `RECORD_SHEET_PHONE_MAX_VIEWPORT_SHARE`.
  const {
    isCollapsed,
    isDragging,
    isEasing,
    sheetHeight,
    isBodyShown,
    isJustAfterDrag,
    toggleCollapsed,
    unfold,
  } = useRecordSheet({ panel, handle, maxViewportRatio: RECORD_SHEET_PHONE_MAX_VIEWPORT_SHARE })

  const period = computed(() =>
    site.value ? formatPeriod(site.value.periodFrom, site.value.periodTo, t) : '',
  )

  const coordinates = computed(() =>
    site.value
      ? `${site.value.position.lat.toFixed(5)}, ${site.value.position.lon.toFixed(5)}`
      : '',
  )

  const categoryLabel = computed(() => {
    const category = site.value?.category
    if (!category) return t('siteDetail.loading')
    return te(`categories.${category}`) ? t(`categories.${category}`) : t('categories.other')
  })

  const close = (): void => {
    if (isJustAfterDrag()) return
    selectSite(null)
  }

  const showRecordsHere = (): void => {
    if (isJustAfterDrag()) return
    returnToOverlappingFeatures()
  }

  /**
   * The panel stays mounted while the record under it changes or the sheet is
   * put away, so a folded sheet would greet the next record folded — and a
   * reader who tapped another marker wants to read it.
   */
  watch(selectedSiteId, unfold)

  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && isPanelOpen.value) close()
  }

  onMounted(() => {
    window.addEventListener('keydown', handleEscape)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleEscape)
  })
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
      v-if="isPanelOpen"
      ref="panel"
      class="pointer-events-auto absolute inset-x-0 bottom-0 z-30 max-h-[78dvh] overflow-y-auto rounded-t-lg bg-paper-50 pb-10 shadow-lifted md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-paper-200 md:pb-0 dark:bg-night-800 dark:md:border-night-700"
      :class="
        isEasing
          ? 'transition-[max-height] duration-200 ease-out motion-reduce:transition-none'
          : ''
      "
      :style="sheetHeight === null ? undefined : { maxHeight: `${sheetHeight}px` }"
      :aria-label="t('siteDetail.panelLabel')"
    >
      <!--
        The grab handle only exists on the sheet; on desktop it would be a lie.
        Dragging it folds the sheet down to this row (`useFoldableSheet`);
        `touch-none` keeps the browser from taking the gesture for a scroll.
        The 40px floor under the folded row (`pb-10`) is what the key and the
        map credit sit on — see `LimesPanel.vue`.
      -->
      <div
        ref="handle"
        class="sticky top-0 z-10 cursor-grab touch-none select-none bg-paper-50 pt-2 dark:bg-night-800 md:cursor-auto md:touch-auto md:select-auto md:pt-0"
        :class="isDragging ? 'cursor-grabbing' : ''"
      >
        <div
          class="mx-auto mb-1 h-1 w-10 rounded-full bg-paper-300 dark:bg-night-600 md:hidden"
          aria-hidden="true"
        />
        <div
          class="flex items-start gap-3 border-b border-paper-200 px-5 py-3 dark:border-night-700"
        >
          <p class="eyebrow pt-1">{{ categoryLabel }}</p>

          <div class="ml-auto flex items-center gap-1">
            <!--
            Only when the tap actually landed on a pile. The list is kept while
            a record from it is open, so stepping back does not mean finding
            the same pixel a second time.
          -->
            <button
              v-if="hasOverlappingFeatures"
              type="button"
              class="flex items-center gap-1 rounded-notebook px-2 py-1 text-xs text-ink-500 transition hover:bg-paper-200 dark:text-paper-400 dark:hover:bg-night-700"
              @click="showRecordsHere"
            >
              <UIcon name="i-lucide-chevron-left" class="size-3.5" aria-hidden="true" />
              {{ t('siteDetail.recordsHere', { count: overlappingFeatures.length }) }}
            </button>

            <!-- Dragging is a pointer gesture; this is what a keyboard or a screen reader gets. -->
            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded-notebook text-ink-500 transition hover:bg-paper-200 md:hidden dark:text-paper-400 dark:hover:bg-night-700"
              :aria-expanded="!isCollapsed"
              :aria-label="isCollapsed ? t('recordSheet.unfold') : t('recordSheet.fold')"
              @click="toggleCollapsed"
            >
              <UIcon
                :name="isCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="size-4"
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded-notebook text-ink-500 transition hover:bg-paper-200 dark:text-paper-400 dark:hover:bg-night-700"
              :aria-label="t('siteDetail.close')"
              @click="close"
            >
              <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div v-show="isBodyShown">
        <div v-if="status === 'pending'" class="space-y-3 p-5">
          <div class="h-7 w-2/3 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
          <div class="h-4 w-full animate-pulse rounded bg-paper-200 dark:bg-night-700" />
          <div class="h-4 w-4/5 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
        </div>

        <article v-else-if="site" class="px-5 py-5">
          <h2 class="text-2xl leading-tight">{{ site.title }}</h2>

          <p
            v-if="site.summary"
            class="mt-2 text-[0.95rem] leading-relaxed text-ink-700 dark:text-paper-200"
          >
            {{ site.summary }}
          </p>

          <SiteMetaList
            :period="period"
            :coordinates="coordinates"
            :modern-place="site.modernPlace"
            :country-code="site.countryCode"
            class="mt-5"
          />

          <SiteGallery v-if="site.images.length > 0" :images="site.images" class="mt-6" />

          <div
            v-if="site.description"
            class="prose-notebook mt-6 space-y-3 text-[0.95rem] leading-relaxed text-ink-700 dark:text-paper-200"
          >
            <p v-for="(paragraph, index) in site.description.split('\n\n')" :key="index">
              {{ paragraph }}
            </p>
          </div>

          <SiteEnrichment
            :enrichment="enrichment"
            :is-loading="isLoadingEnrichment"
            class="mt-6 block"
          />

          <SiteExternalLinks
            v-if="site.externalIds.length > 0"
            :identifiers="site.externalIds"
            class="mt-6"
          />

          <!--
            Only a record the source calls a watchtower: the calculation answers for
            frontier towers and says nothing for the rest, and asking for every site
            would be a request per opened record that is null 99 times in 100.
          -->
          <TerrainTowerSightlines
            v-if="site.subcategory === 'watchtower'"
            :key="site.id"
            :site-id="site.id"
            class="mt-6"
          />

          <EpigraphyNearbyInscriptions :id="site.id" kind="site" class="mt-6" />
          <EpigraphyNearbyAtticInscriptions :id="site.id" kind="site" class="mt-6" />

          <SiteEndorsementButton v-model="site" class="mt-6" />

          <!--
            The reader's own traces. Only for a signed-in visitor, because these
            are stored against an account — there is no anonymous local-only mode,
            which would quietly split the notebook across devices.
          -->
          <NotebookControls
            v-if="loggedIn"
            :key="site.id"
            :site-id="site.id"
            :title="site.title"
            :longitude="site.position.lon"
            :latitude="site.position.lat"
            class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700"
          />

          <div
            class="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-3 dark:border-night-700"
          >
            <NuxtLink
              :to="`/site/${site.slug}`"
              class="text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
            >
              {{ t('siteDetail.openFullEntry') }}
            </NuxtLink>
            <NuxtLink
              v-if="loggedIn"
              :to="`/site/${site.slug}/edit`"
              class="text-sm text-ink-500 underline underline-offset-2 dark:text-paper-400"
            >
              {{ t('siteDetail.edit') }}
            </NuxtLink>
            <p class="datum ml-auto">
              {{ t('siteDetail.revised') }}
              <time :datetime="site.updatedAt">{{ formatDate(site.updatedAt, locale) }}</time>
            </p>
          </div>
        </article>

        <p v-else class="p-5 text-sm text-ink-500 dark:text-paper-400">
          {{ t('siteDetail.notFound') }}
        </p>
      </div>
    </aside>
  </Transition>
</template>
