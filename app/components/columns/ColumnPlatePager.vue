<script setup lang="ts">
  /**
   * Plate N of M, with N typed directly.
   *
   * Both column viewers are OpenSeadragon sequences, and OpenSeadragon's own
   * sequence control is two arrows and nothing else: reaching plate 90 of 128
   * meant 89 clicks and no way to know where you were while doing it. This is
   * the counter — a number the reader can read *and* set.
   *
   * Pages are 0-based everywhere in the code, because that is what
   * OpenSeadragon's `goToPage`/`currentPage` speak, and 1-based everywhere on
   * screen, because that is what a plate is called. The conversion happens
   * here, once.
   */
  interface Props {
    /** 0-based, matching OpenSeadragon. */
    page: number
    total: number
  }

  const { page, total } = defineProps<Props>()
  const emit = defineEmits<{ 'update:page': [page: number] }>()

  const { t } = useI18n()

  /**
   * The field's own draft, not the page itself. Typing "1" on the way to "12"
   * must not jump the viewer to plate 1 and re-render it, so the number is
   * only committed on `change` (blur or Enter) — `input` would fire per
   * keystroke.
   */
  const draft = ref(String(page + 1))

  const goTo = (nextPage: number): void => {
    if (nextPage >= 0 && nextPage < total && nextPage !== page) emit('update:page', nextPage)
  }

  /**
   * An out-of-range or non-numeric entry is refused, not clamped: silently
   * turning "200" into plate 128 looks like the field ignored what was typed.
   * The draft snaps back to where the viewer actually is, which says so.
   */
  const commitDraft = (): void => {
    const typed = Number(draft.value)
    const isUsable = Number.isInteger(typed) && typed >= 1 && typed <= total
    if (isUsable) goTo(typed - 1)
    draft.value = String((isUsable ? typed - 1 : page) + 1)
  }

  watch(
    () => page,
    (current) => {
      draft.value = String(current + 1)
    },
  )
</script>

<template>
  <nav
    v-if="total > 0"
    class="flex items-center justify-center gap-2"
    :aria-label="t('columns.pager.label')"
  >
    <UButton
      icon="i-lucide-chevron-left"
      color="neutral"
      variant="ghost"
      size="sm"
      :disabled="page <= 0"
      :aria-label="t('columns.pager.previous')"
      @click="goTo(page - 1)"
    />

    <!--
      `type="number"` rather than a select of 128 options: a reader who knows
      they want Tafel XCV wants to type 95, and a phone gets its numeric
      keypad from the type. Named by `aria-label` rather than a wrapping
      `<label>` — the control is a component, so there is no element here to
      point a `for` at, and the adjacent "of 128" is not a name.
    -->
    <div class="flex items-center gap-2 text-sm text-ink-700 dark:text-paper-200">
      <UInput
        v-model="draft"
        type="number"
        inputmode="numeric"
        :min="1"
        :max="total"
        size="sm"
        :aria-label="t('columns.pager.pageNumber')"
        :ui="{ base: 'text-center font-mono' }"
        class="w-20"
        @change="commitDraft"
        @keydown.enter.prevent="commitDraft"
      />
      <span class="whitespace-nowrap font-mono text-xs text-ink-500 dark:text-paper-400">
        {{ t('columns.pager.of', { total }) }}
      </span>
    </div>

    <UButton
      icon="i-lucide-chevron-right"
      color="neutral"
      variant="ghost"
      size="sm"
      :disabled="page >= total - 1"
      :aria-label="t('columns.pager.next')"
      @click="goTo(page + 1)"
    />
  </nav>
</template>
