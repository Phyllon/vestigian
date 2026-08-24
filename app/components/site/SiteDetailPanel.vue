<script setup lang="ts">
  const {
    site,
    status,
    selectSite,
    isPanelOpen,
    overlappingFeatures,
    hasOverlappingFeatures,
    returnToOverlappingFeatures,
  } = useSiteQuery()
  const { loggedIn } = useSession()
  const { isCompact } = useBreakpoint()

  const period = computed(() =>
    site.value ? formatPeriod(site.value.periodFrom, site.value.periodTo) : '',
  )

  const coordinates = computed(() =>
    site.value
      ? `${site.value.position.lat.toFixed(5)}, ${site.value.position.lon.toFixed(5)}`
      : '',
  )

  const close = (): void => selectSite(null)

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
    <aside
      v-if="isPanelOpen"
      class="pointer-events-auto fixed inset-x-0 bottom-0 z-30 max-h-[78vh] overflow-y-auto rounded-t-lg bg-paper-50 shadow-lifted md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-paper-200 dark:bg-night-800 dark:md:border-night-700"
      aria-label="Site details"
    >
      <!-- The grab handle only exists on the sheet; on desktop it would be a lie. -->
      <div class="sticky top-0 z-10 bg-paper-50 pt-2 dark:bg-night-800 md:pt-0">
        <div class="mx-auto mb-1 h-1 w-10 rounded-full bg-paper-300 dark:bg-night-600 md:hidden" />
        <div
          class="flex items-start gap-3 border-b border-paper-200 px-5 py-3 dark:border-night-700"
        >
          <p class="eyebrow pt-1">{{ site?.category ?? 'Loading' }}</p>

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
              @click="returnToOverlappingFeatures"
            >
              <UIcon name="i-lucide-chevron-left" class="size-3.5" />
              {{ overlappingFeatures.length }} records here
            </button>

            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded-notebook text-ink-500 transition hover:bg-paper-200 dark:text-paper-400 dark:hover:bg-night-700"
              aria-label="Close site details"
              @click="close"
            >
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-5">
        <div class="h-7 w-2/3 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
        <div class="h-4 w-full animate-pulse rounded bg-paper-200 dark:bg-night-700" />
        <div class="h-4 w-4/5 animate-pulse rounded bg-paper-200 dark:bg-night-700" />
      </div>

      <article v-else-if="site" class="px-5 py-5">
        <h1 class="text-2xl leading-tight">{{ site.title }}</h1>

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

        <SiteExternalLinks
          v-if="site.externalIds.length > 0"
          :identifiers="site.externalIds"
          class="mt-6"
        />

        <div
          class="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-3 dark:border-night-700"
        >
          <NuxtLink
            :to="`/site/${site.slug}`"
            class="text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
          >
            Open the full entry
          </NuxtLink>
          <NuxtLink
            v-if="loggedIn"
            :to="`/site/${site.slug}/edit`"
            class="text-sm text-ink-500 underline underline-offset-2 dark:text-paper-400"
          >
            Edit
          </NuxtLink>
          <p class="datum ml-auto">
            Revised
            {{ new Date(site.updatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) }}
          </p>
        </div>
      </article>

      <p v-else class="p-5 text-sm text-ink-500 dark:text-paper-400">
        That site could not be loaded. It may have been removed or is awaiting review.
      </p>
    </aside>
  </Transition>
</template>
