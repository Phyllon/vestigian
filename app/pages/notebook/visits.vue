<script setup lang="ts">
  /**
   * The visit log — the one part of this atlas that is only about its reader.
   *
   * "Vestigia" is traces, and until now the one set of traces the project did
   * not record was the visitor's own. Everything here is private: it is never
   * joined into `/api/data/sites.geojson`, never drawn into a shared tile, and
   * never visible on a public contributor page.
   */
  const { t, locale } = useI18n()
  const toast = useToast()
  const { removeVisit } = useNotebook()

  const { data: visits, pending, error, refresh } = await useFetch('/api/me/visits')
  const { data: bookmarks, refresh: refreshBookmarks } = await useFetch('/api/me/bookmarks')

  const removing = ref<number | null>(null)

  const forget = async (siteId: number): Promise<void> => {
    removing.value = siteId
    try {
      await removeVisit(siteId)
      await refresh()
    } catch {
      toast.add({ title: t('notebook.visitRemoveFailed'), color: 'error' })
    } finally {
      removing.value = null
    }
  }

  const dropBookmark = async (siteId: number): Promise<void> => {
    removing.value = siteId
    try {
      await $fetch(`/api/me/bookmarks/${siteId}`, { method: 'DELETE' })
      await refreshBookmarks()
    } catch {
      toast.add({ title: t('notebook.bookmarkRemoveFailed'), color: 'error' })
    } finally {
      removing.value = null
    }
  }

  useHead({ title: t('notebook.visitsTitle') })
  useNoIndex()

  definePageMeta({ layout: 'reading', middleware: 'authenticated' })
</script>

<template>
  <article>
    <NuxtLink
      to="/notebook"
      class="eyebrow inline-flex items-center gap-1 hover:text-ink-900 dark:hover:text-paper-100"
    >
      <UIcon name="i-lucide-arrow-left" class="size-3" />
      {{ t('notebook.title') }}
    </NuxtLink>

    <h1 class="mt-3 font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('notebook.visitsTitle') }}
    </h1>
    <p class="mt-3 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('notebook.visitsIntro') }}
    </p>

    <p v-if="pending" class="mt-8 text-sm text-ink-500 dark:text-paper-400">
      {{ t('notebook.loading') }}
    </p>
    <p v-else-if="error" class="mt-8 text-sm text-oxide-700 dark:text-oxide-400">
      {{ t('notebook.loadFailed') }}
    </p>

    <template v-else>
      <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 class="eyebrow">{{ t('notebook.visitsHeading', visits?.length ?? 0) }}</h2>
        <!--
          A plain link, not a fetch-and-blob: the response already carries
          `content-disposition: attachment`, so the browser saves it with the
          right name and the page does nothing.
        -->
        <UButton
          v-if="(visits?.length ?? 0) + (bookmarks?.length ?? 0) > 0"
          to="/api/me/field-kit.gpx"
          external
          download
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-map-pin"
        >
          {{ t('notebook.fieldKit') }}
        </UButton>
      </div>

      <p v-if="(visits?.length ?? 0) === 0" class="mt-3 text-sm text-ink-600 dark:text-paper-300">
        {{ t('notebook.visitsEmpty') }}
      </p>

      <ul v-else class="mt-3 space-y-3">
        <li v-for="visit in visits" :key="visit.siteId" class="leaf p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <NuxtLink
                :to="`/site/${visit.slug}`"
                class="font-display text-lg text-ink-900 hover:text-oxide-700 dark:text-paper-100 dark:hover:text-oxide-400"
              >
                {{ visit.title }}
              </NuxtLink>
              <p class="mt-0.5 text-xs text-ink-500 dark:text-paper-400">
                <time v-if="visit.visitedOn" :datetime="visit.visitedOn" class="datum">
                  {{ formatDate(visit.visitedOn, locale) }}
                </time>
                <span v-else>{{ t('notebook.undated') }}</span>
                <template v-if="visit.modernPlace"> · {{ visit.modernPlace }}</template>
              </p>
            </div>

            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              :loading="removing === visit.siteId"
              :aria-label="t('notebook.forgetVisit', { title: visit.title })"
              @click="forget(visit.siteId)"
            />
          </div>

          <p
            v-if="visit.note"
            class="mt-2 whitespace-pre-line border-l-2 border-bronze-400 pl-3 text-sm leading-relaxed text-ink-700 dark:border-bronze-600 dark:text-paper-200"
          >
            {{ visit.note }}
          </p>
        </li>
      </ul>

      <section class="mt-10 border-t border-paper-200 pt-5 dark:border-night-700">
        <h2 class="eyebrow">{{ t('notebook.bookmarksHeading', bookmarks?.length ?? 0) }}</h2>
        <p class="mt-2 text-sm text-ink-600 dark:text-paper-300">
          {{ t('notebook.bookmarksIntro') }}
        </p>

        <ul v-if="(bookmarks?.length ?? 0) > 0" class="mt-3 space-y-2">
          <li
            v-for="bookmark in bookmarks"
            :key="bookmark.siteId"
            class="flex items-center justify-between gap-3 rounded-notebook border border-paper-200 px-4 py-2.5 dark:border-night-700"
          >
            <NuxtLink
              :to="`/site/${bookmark.slug}`"
              class="min-w-0 truncate text-sm text-ink-800 hover:text-oxide-700 dark:text-paper-100 dark:hover:text-oxide-400"
            >
              {{ bookmark.title }}
              <span v-if="bookmark.modernPlace" class="text-ink-500 dark:text-paper-400">
                · {{ bookmark.modernPlace }}
              </span>
            </NuxtLink>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              :loading="removing === bookmark.siteId"
              :aria-label="t('notebook.dropBookmark', { title: bookmark.title })"
              @click="dropBookmark(bookmark.siteId)"
            />
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-ink-600 dark:text-paper-300">
          {{ t('notebook.bookmarksEmpty') }}
        </p>
      </section>
    </template>
  </article>
</template>
