<script setup lang="ts">
  import type { ColumnReliefPlateSummary } from '#shared/types'

  const { t } = useI18n()

  const {
    data: plates,
    pending,
    error,
  } = await useFetch<ColumnReliefPlateSummary[]>('/api/column-reliefs', {
    query: { monument: 'trajans-column' },
  })

  const openIndex = ref<number | null>(null)
  const modalOpen = ref(false)

  const open = (index: number): void => {
    openIndex.value = index
    modalOpen.value = true
  }

  const buildThumbUrl = (plate: ColumnReliefPlateSummary): string =>
    `/api/column-reliefs/${plate.id}/thumb`

  const plateLabel = (plate: ColumnReliefPlateSummary): string =>
    plate.sceneNumber ? t('columns.trajan.scene', { number: plate.sceneNumber }) : plate.title
</script>

<template>
  <div>
    <p v-if="pending" class="datum">{{ t('columns.trajan.loading') }}</p>
    <p v-else-if="error" class="datum text-oxide-600 dark:text-oxide-300">
      {{ t('columns.trajan.loadFailed') }}
    </p>
    <p v-else-if="!plates?.length" class="datum">{{ t('columns.trajan.empty') }}</p>

    <ul
      v-else
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      :aria-label="t('columns.trajan.gridLabel')"
    >
      <li v-for="(plate, index) in plates" :key="plate.id">
        <button
          type="button"
          class="leaf group w-full overflow-hidden p-0 text-left transition hover:shadow-lifted"
          @click="open(index)"
        >
          <img
            :src="buildThumbUrl(plate)"
            :alt="plateLabel(plate)"
            class="aspect-square w-full object-cover"
            loading="lazy"
            decoding="async"
          />
          <span class="block px-2 py-1.5 text-xs text-ink-700 dark:text-paper-200">
            {{ plateLabel(plate) }}
          </span>
        </button>
      </li>
    </ul>

    <!--
      A modal, and inside it a real deep-zoom viewer rather than a carousel of
      `<img>` elements in a scrollable frame — see
      `ColumnTrajanViewer.client.vue` for the four things that frame got wrong
      and why OpenSeadragon replaced it.

      Only mounted while the modal is open (`v-if`), so `start-index` applies
      fresh to whichever thumbnail was actually clicked each time and no
      viewer instance outlives the panel it was drawn in.
    -->
    <UModal
      v-model:open="modalOpen"
      :title="t('columns.trajan.tabLabel')"
      :ui="{ content: 'max-w-5xl w-[95vw] sm:w-[90vw]' }"
    >
      <template #body>
        <ColumnsColumnTrajanViewer
          v-if="plates?.length && openIndex !== null"
          :plates="plates"
          :start-index="openIndex"
        />
      </template>
    </UModal>
  </div>
</template>
