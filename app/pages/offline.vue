<script setup lang="ts">
  /**
   * What has been downloaded for offline use, and how much of the device it
   * takes up.
   *
   * Device-local, not account data: no session is required to see or manage
   * this, because the areas themselves live in this browser's Cache Storage
   * and nowhere else — a second device, or the same device signed out, simply
   * has none. `useOfflineAreas`'s `localStorage` list is the only source of
   * truth this page reads; there is nothing to fetch from the server.
   */
  import { formatBytes } from '#shared/utils/bytes'

  const { t, locale } = useI18n()
  const { areas, refresh, totalBytes, remove } = useOfflineAreas()
  const toast = useToast()

  const removingId = ref<string | null>(null)

  const forget = async (id: string): Promise<void> => {
    removingId.value = id
    try {
      await remove(id)
    } catch {
      toast.add({ title: t('offlinePage.removeFailed'), color: 'error' })
    } finally {
      removingId.value = null
    }
  }

  useHead({ title: t('offlinePage.title') })
  useNoIndex()

  definePageMeta({ layout: 'reading' })

  // `useOfflineAreas`'s state does not populate itself on the client — see
  // the note on `refresh` in the composable — so every surface that displays
  // the list has to ask for it explicitly, once mounted.
  onMounted(refresh)
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('offlinePage.title') }}
    </h1>
    <p class="mt-3 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('offlinePage.intro') }}
    </p>

    <p v-if="areas.length > 0" class="mt-6 datum text-sm text-ink-600 dark:text-paper-300">
      {{ t('offlinePage.totalUsage', { size: formatBytes(totalBytes, locale) }) }}
    </p>

    <p v-if="areas.length === 0" class="mt-8 text-sm text-ink-600 dark:text-paper-300">
      {{ t('offlinePage.empty') }}
    </p>

    <ul v-else class="mt-6 space-y-3">
      <li v-for="area in areas" :key="area.id" class="leaf p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-display text-lg text-ink-900 dark:text-paper-100">{{ area.name }}</p>
            <p class="mt-0.5 text-xs text-ink-500 dark:text-paper-400">
              {{
                t('offlinePage.areaMeta', {
                  count: area.tileCount,
                  size: formatBytes(area.byteSize, locale),
                })
              }}
              <template v-if="area.includesBasemap"> · {{ t('offlinePage.withBasemap') }}</template>
            </p>
          </div>

          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            :loading="removingId === area.id"
            :aria-label="t('offlinePage.remove', { name: area.name })"
            @click="forget(area.id)"
          />
        </div>
      </li>
    </ul>
  </article>
</template>
