<script setup lang="ts">
  /**
   * "I have stood here" and "Add to field kit", for one site.
   *
   * The visit control opens a small form rather than toggling outright: a date
   * and a note are the two things that make a visit worth having recorded, and
   * asking for them after the fact means nobody ever supplies them. Both are
   * optional — an undated visit is a real answer, which is why
   * `site_visits.visited_on` is nullable.
   *
   * The bookmark is a plain toggle, because there is nothing to say about
   * intending to go somewhere.
   */
  const props = defineProps<{
    siteId: number
    title: string
    longitude: number
    latitude: number
  }>()

  const { t } = useI18n()
  const toast = useToast()
  const { load, entryFor, hasVisited, hasBookmarked, recordVisit, removeVisit, toggleBookmark } =
    useNotebook()

  const isFormOpen = ref(false)
  const visitedOn = ref('')
  const note = ref('')
  const isSaving = ref(false)

  const visited = computed(() => hasVisited(props.siteId))
  const bookmarked = computed(() => hasBookmarked(props.siteId))

  /** Today, in the browser's own timezone — `toISOString` would be UTC's day. */
  const today = computed(() => {
    const now = new Date()
    const offset = now.getTimezoneOffset() * 60_000
    return new Date(now.getTime() - offset).toISOString().slice(0, 10)
  })

  const openForm = (): void => {
    const entry = entryFor(props.siteId)
    visitedOn.value = entry?.visitedOn ?? today.value
    note.value = entry?.note ?? ''
    isFormOpen.value = true
  }

  const save = async (): Promise<void> => {
    isSaving.value = true
    try {
      await recordVisit({
        siteId: props.siteId,
        visitedOn: visitedOn.value || null,
        note: note.value.trim() || null,
        longitude: props.longitude,
        latitude: props.latitude,
      })
      isFormOpen.value = false
      toast.add({ title: t('notebook.visitSaved', { title: props.title }), color: 'success' })
    } catch {
      toast.add({ title: t('notebook.visitSaveFailed'), color: 'error' })
    } finally {
      isSaving.value = false
    }
  }

  const forget = async (): Promise<void> => {
    isSaving.value = true
    try {
      await removeVisit(props.siteId)
      isFormOpen.value = false
    } catch {
      toast.add({ title: t('notebook.visitRemoveFailed'), color: 'error' })
    } finally {
      isSaving.value = false
    }
  }

  const onBookmark = async (): Promise<void> => {
    try {
      await toggleBookmark(props.siteId, {
        longitude: props.longitude,
        latitude: props.latitude,
      })
    } catch {
      toast.add({ title: t('notebook.bookmarkFailed'), color: 'error' })
    }
  }

  onMounted(load)
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        :color="visited ? 'success' : 'neutral'"
        :variant="visited ? 'soft' : 'outline'"
        size="sm"
        :icon="visited ? 'i-lucide-check' : 'i-lucide-footprints'"
        :aria-expanded="isFormOpen"
        @click="isFormOpen ? (isFormOpen = false) : openForm()"
      >
        {{ visited ? t('notebook.visitedHere') : t('notebook.markVisited') }}
      </UButton>

      <UButton
        :color="bookmarked ? 'secondary' : 'neutral'"
        :variant="bookmarked ? 'soft' : 'ghost'"
        size="sm"
        :icon="bookmarked ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'"
        :aria-pressed="bookmarked"
        @click="onBookmark"
      >
        {{ bookmarked ? t('notebook.inFieldKit') : t('notebook.addToFieldKit') }}
      </UButton>
    </div>

    <form
      v-if="isFormOpen"
      method="post"
      class="mt-3 space-y-3 rounded-notebook border border-paper-200 p-3 dark:border-night-700"
      @submit.prevent="save"
    >
      <UFormField :label="t('notebook.visitedOn')" :help="t('notebook.visitedOnHelp')">
        <UInput v-model="visitedOn" type="date" :max="today" class="w-full" />
      </UFormField>

      <UFormField :label="t('notebook.visitNote')" :help="t('notebook.visitNoteHelp')">
        <UTextarea v-model="note" :rows="3" maxlength="2000" class="w-full" />
      </UFormField>

      <div class="flex flex-wrap items-center gap-2">
        <UButton type="submit" size="sm" :loading="isSaving">{{ t('notebook.saveVisit') }}</UButton>
        <UButton
          v-if="visited"
          type="button"
          color="error"
          variant="ghost"
          size="sm"
          :loading="isSaving"
          @click="forget"
        >
          {{ t('notebook.forget') }}
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="isFormOpen = false"
        >
          {{ t('notebook.cancel') }}
        </UButton>
      </div>
    </form>
  </div>
</template>
