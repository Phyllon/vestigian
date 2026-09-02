<script setup lang="ts">
  /**
   * "Download this area for offline use."
   *
   * The bbox is whatever the map currently shows, read once when the panel
   * opens — not a drawn shape, not a typed address. Every reader who wants
   * this already has the area on screen; asking them to describe it a second
   * time would be the wrong tax on the one feature meant to work without
   * signal.
   */
  import { formatBytes } from '#shared/utils/bytes'
  import { TileCountExceededError } from '#shared/utils/tiles'
  import type { BoundingBox } from '#shared/types'

  const { t, locale } = useI18n()
  const map = useMapInstance()
  const { estimate, checkQuota, download, isBasemapDownloadable } = useOfflineAreas()
  const toast = useToast()

  const isOpen = ref(false)
  const bbox = ref<BoundingBox | null>(null)

  const ZOOM_TIERS = [
    { value: 8, labelKey: 'offline.tierOverview' },
    { value: 11, labelKey: 'offline.tierRegional' },
    { value: 13, labelKey: 'offline.tierDetailed' },
  ] as const

  const maxZoom = ref<number>(ZOOM_TIERS[1].value)
  const includeBasemap = ref(false)
  const name = ref('')

  const isEstimating = ref(false)
  const estimateResult = ref<Awaited<ReturnType<typeof estimate>> | null>(null)
  const estimateError = ref<string | null>(null)
  const quota = ref<Awaited<ReturnType<typeof checkQuota>> | null>(null)

  const isDownloading = ref(false)
  const progress = ref({ tilesDone: 0, tilesTotal: 0, bytesDone: 0 })
  const controller = ref<AbortController | null>(null)

  const defaultName = (): string =>
    `${new Date().toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })}`

  const runEstimate = async (): Promise<void> => {
    if (!bbox.value) return
    isEstimating.value = true
    estimateError.value = null
    try {
      const result = await estimate(bbox.value, maxZoom.value, includeBasemap.value)
      estimateResult.value = result
      quota.value = await checkQuota(result.totalEstimatedBytes)
    } catch (error) {
      estimateResult.value = null
      estimateError.value =
        error instanceof TileCountExceededError
          ? t('offline.tooLarge')
          : t('offline.estimateFailed')
    } finally {
      isEstimating.value = false
    }
  }

  watch([maxZoom, includeBasemap], runEstimate)

  const open = (): void => {
    const instance = map.value
    if (!instance) return
    const bounds = instance.getBounds()
    bbox.value = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }
    name.value = defaultName()
    isOpen.value = true
    void runEstimate()
  }

  const close = (): void => {
    if (isDownloading.value) return
    isOpen.value = false
  }

  const startDownload = async (): Promise<void> => {
    if (!bbox.value) return
    isDownloading.value = true
    progress.value = { tilesDone: 0, tilesTotal: 0, bytesDone: 0 }
    controller.value = new AbortController()

    try {
      await download(
        {
          name: name.value.trim() || defaultName(),
          bbox: bbox.value,
          maxZoom: maxZoom.value,
          includeBasemap: includeBasemap.value,
        },
        (update) => {
          progress.value = update
        },
        controller.value.signal,
      )
      toast.add({ title: t('offline.downloadComplete'), color: 'success' })
      isOpen.value = false
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') {
        toast.add({ title: t('offline.downloadFailed'), color: 'error' })
      }
    } finally {
      isDownloading.value = false
      controller.value = null
    }
  }

  const cancelDownload = (): void => {
    controller.value?.abort()
  }

  const progressPercent = computed(() =>
    progress.value.tilesTotal > 0
      ? (progress.value.tilesDone / progress.value.tilesTotal) * 100
      : 0,
  )
</script>

<template>
  <div class="flex flex-col items-end gap-2">
    <button
      type="button"
      class="leaf grid size-11 place-items-center text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-label="t('offline.openPanel')"
      :title="t('offline.openPanel')"
      @click="open"
    >
      <UIcon name="i-lucide-download" class="size-5" />
    </button>

    <div v-if="isOpen" class="leaf w-72 space-y-4 p-4">
      <div class="flex items-start justify-between gap-2">
        <h2 class="font-display text-base text-ink-900 dark:text-paper-100">
          {{ t('offline.panelTitle') }}
        </h2>
        <button
          type="button"
          class="text-ink-500 hover:text-ink-900 dark:text-paper-400 dark:hover:text-paper-100"
          :disabled="isDownloading"
          :aria-label="t('offline.close')"
          @click="close"
        >
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </div>

      <p class="text-xs text-ink-600 dark:text-paper-300">{{ t('offline.panelIntro') }}</p>

      <template v-if="!isDownloading">
        <UFormField :label="t('offline.name')">
          <UInput v-model="name" maxlength="60" class="w-full" />
        </UFormField>

        <UFormField :label="t('offline.detail')">
          <USelectMenu
            v-model="maxZoom"
            :items="
              ZOOM_TIERS.map((tier) => ({ label: t(tier.labelKey), value: tier.value as number }))
            "
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UCheckbox
          v-if="isBasemapDownloadable"
          v-model="includeBasemap"
          :label="t('offline.includeBasemap')"
        />
        <p v-else class="text-xs text-ink-500 dark:text-paper-400">
          {{ t('offline.basemapUnavailable') }}
        </p>

        <p v-if="isEstimating" class="datum text-xs text-ink-500 dark:text-paper-400">
          {{ t('offline.estimating') }}
        </p>
        <p v-else-if="estimateError" class="text-xs text-oxide-700 dark:text-oxide-400">
          {{ estimateError }}
        </p>
        <div v-else-if="estimateResult" class="space-y-1">
          <p class="datum text-sm text-ink-800 dark:text-paper-100">
            {{
              t('offline.estimateSummary', {
                size: formatBytes(estimateResult.totalEstimatedBytes, locale),
                count: estimateResult.totalTiles,
              })
            }}
          </p>
          <p
            v-if="quota && quota.supported && !quota.fits"
            class="text-xs text-oxide-700 dark:text-oxide-400"
          >
            {{ t('offline.quotaWarning') }}
          </p>
        </div>

        <UButton
          block
          :disabled="isEstimating || !estimateResult"
          icon="i-lucide-download"
          @click="startDownload"
        >
          {{ t('offline.startDownload') }}
        </UButton>
      </template>

      <template v-else>
        <UProgress :model-value="progressPercent" />
        <p class="datum text-xs text-ink-600 dark:text-paper-300">
          {{
            t('offline.downloadProgress', {
              done: progress.tilesDone,
              total: progress.tilesTotal,
              size: formatBytes(progress.bytesDone, locale),
            })
          }}
        </p>
        <UButton block color="neutral" variant="outline" @click="cancelDownload">
          {{ t('offline.cancel') }}
        </UButton>
      </template>

      <NuxtLink to="/offline" class="block text-center text-xs underline underline-offset-2">
        {{ t('offline.manageLink') }}
      </NuxtLink>
    </div>
  </div>
</template>
