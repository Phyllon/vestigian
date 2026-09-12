<script setup lang="ts">
  import type { AdminActivityResponse, AdminRevisionEntry } from '#shared/types'

  /**
   * Every change the atlas has published, whoever published it.
   *
   * The moderator's queue answers "what needs deciding". This answers "what
   * happened" — and the difference is the whole reason the panel exists, since
   * a trusted contributor's edits go straight to the map and have never
   * appeared on any screen in this application. The `autoApproved` flag is
   * therefore the most important thing on each row, not a detail: it marks the
   * edits nobody looked at.
   */
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()

  /**
   * `'any'` rather than `''` for "no filter". Reka UI's `SelectItem` refuses
   * an empty-string `value` outright — it reserves `''` internally to mean
   * "cleared, show the placeholder" — so an item using it as an ordinary
   * option throws during setup and takes the whole dropdown down with it.
   */
  const status = ref<'any' | 'pending' | 'approved' | 'rejected'>('any')
  const entityType = ref<'any' | 'site' | 'tracing'>('any')
  const autoApprovedOnly = ref(false)
  const blankingOnly = ref(false)
  const search = ref('')
  const debouncedSearch = ref('')

  let debounce: ReturnType<typeof setTimeout> | undefined

  watch(search, (value) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      debouncedSearch.value = value.trim()
    }, 300)
  })

  /**
   * An author filter arriving from the dossier's "see everything they
   * changed", and a single revision arriving from the command bar. Both come
   * from the URL rather than from a prop, so a link into either survives a
   * reload.
   */
  const authorId = computed<number | undefined>(() => {
    const raw = Number(route.query.author)
    return Number.isInteger(raw) && raw > 0 ? raw : undefined
  })

  const highlightedRevision = computed<number | null>(() => {
    const raw = Number(route.query.revision)
    return Number.isInteger(raw) && raw > 0 ? raw : null
  })

  const pages = ref<AdminRevisionEntry[][]>([])
  const cursor = ref<number | null>(null)

  const query = computed(() => ({
    status: status.value === 'any' ? undefined : status.value,
    entityType: entityType.value === 'any' ? undefined : entityType.value,
    authorId: authorId.value,
    autoApprovedOnly: autoApprovedOnly.value || undefined,
    blankingOnly: blankingOnly.value || undefined,
    q: debouncedSearch.value || undefined,
    limit: 30,
  }))

  // Not awaited — see the note in AdminImageQueue.vue on why `server: false`
  // and a top-level `await` together produce a hydration mismatch here.
  const { data, status: fetchStatus } = useFetch<AdminActivityResponse>('/api/admin/activity', {
    server: false,
    query,
  })

  // A changed filter is a new stream, not more of the old one.
  watch(
    query,
    () => {
      pages.value = []
      cursor.value = null
    },
    { deep: true },
  )

  const items = computed(() => [...(data.value?.items ?? []), ...pages.value.flat()])

  const isLoadingMore = ref(false)

  const loadMore = async (): Promise<void> => {
    const next = cursor.value ?? data.value?.nextCursor ?? null
    if (next === null) return

    isLoadingMore.value = true
    try {
      const page = await $fetch<AdminActivityResponse>('/api/admin/activity', {
        query: { ...query.value, cursor: next },
      })
      pages.value = [...pages.value, page.items]
      cursor.value = page.nextCursor
    } finally {
      isLoadingMore.value = false
    }
  }

  const hasMore = computed(() =>
    pages.value.length > 0 ? cursor.value !== null : (data.value?.nextCursor ?? null) !== null,
  )

  const clearAuthorFilter = (): void => {
    void router.replace({ query: { section: 'activity' } })
  }

  /**
   * Navigated here rather than emitted up to the page: the station's state
   * lives in the query string, so the section that wants to move is the
   * section that can, and there is no prop chain to keep in step.
   */
  const focusAccount = (userId: number): void => {
    void router.replace({ query: { section: 'accounts', account: userId } })
  }

  const recordLink = (entry: AdminRevisionEntry): string | null => {
    if (entry.entityId === null) return null
    return entry.entityType === 'tracing' ? `/tracing/${entry.entityId}` : `/site/${entry.entityId}`
  }

  /**
   * One phrase per kind of change, so a reader is told what a row *is* before
   * reading the diff. Ordered by how much it matters: a retraction and a
   * revert are moderation, a blanking edit is a warning, an unreviewed
   * publication is the thing to notice, and everything else is ordinary work.
   */
  const describeKind = (entry: AdminRevisionEntry): string => {
    if (entry.isRetraction) return t('admin.activity.kinds.retraction')
    if (entry.isRevert) return t('admin.activity.kinds.revert')
    if (entry.status === 'pending') return t('admin.activity.kinds.queued')
    if (entry.status === 'rejected') return t('admin.activity.kinds.rejected')
    if (entry.autoApproved) return t('admin.activity.kinds.autoPublished')
    return t('admin.activity.kinds.reviewed')
  }

  const expanded = ref<Set<number>>(new Set())

  const toggle = (id: number): void => {
    const next = new Set(expanded.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded.value = next
  }

  onMounted(() => {
    // A revision arrived by link: open its diff without making the reader
    // hunt for the row and click it.
    if (highlightedRevision.value !== null) {
      expanded.value = new Set([highlightedRevision.value])
    }
  })

  onBeforeUnmount(() => {
    clearTimeout(debounce)
  })
</script>

<template>
  <div class="space-y-4">
    <div class="leaf px-3 py-3 sm:px-4">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField :label="t('admin.activity.filters.search')" class="min-w-0 flex-1">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            size="sm"
            class="w-full"
            :placeholder="t('admin.activity.filters.searchPlaceholder')"
          />
        </UFormField>

        <UFormField :label="t('admin.activity.filters.status')">
          <USelect
            v-model="status"
            size="sm"
            class="w-36"
            :items="[
              { label: t('admin.activity.filters.anyStatus'), value: 'any' },
              { label: t('admin.activity.status.pending'), value: 'pending' },
              { label: t('admin.activity.status.approved'), value: 'approved' },
              { label: t('admin.activity.status.rejected'), value: 'rejected' },
            ]"
          />
        </UFormField>

        <UFormField :label="t('admin.activity.filters.kind')">
          <USelect
            v-model="entityType"
            size="sm"
            class="w-36"
            :items="[
              { label: t('admin.activity.filters.anyKind'), value: 'any' },
              { label: t('admin.activity.filters.sites'), value: 'site' },
              { label: t('admin.activity.filters.tracings'), value: 'tracing' },
            ]"
          />
        </UFormField>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <UCheckbox
          v-model="autoApprovedOnly"
          :label="t('admin.activity.filters.autoApprovedOnly')"
        />
        <UCheckbox v-model="blankingOnly" :label="t('admin.activity.filters.blankingOnly')" />

        <UButton
          v-if="authorId"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-x"
          @click="clearAuthorFilter"
        >
          {{ t('admin.activity.filters.clearAuthor') }}
        </UButton>
      </div>
    </div>

    <p v-if="fetchStatus === 'pending'" class="datum">{{ t('admin.activity.loading') }}</p>

    <ul v-else class="space-y-3">
      <li
        v-for="entry in items"
        :key="entry.id"
        class="leaf px-3 py-3 sm:px-4"
        :class="
          entry.id === highlightedRevision ? 'ring-1 ring-oxide-400 dark:ring-oxide-600' : undefined
        "
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 class="min-w-0 text-base text-ink-900 dark:text-paper-100">
            <NuxtLink
              v-if="recordLink(entry)"
              :to="recordLink(entry)!"
              class="underline decoration-dotted underline-offset-2"
            >
              {{ entry.title ?? t('admin.activity.untitled') }}
            </NuxtLink>
            <span v-else>{{ entry.title ?? t('admin.activity.untitled') }}</span>
          </h3>

          <span class="eyebrow text-ink-500 dark:text-paper-400">{{ describeKind(entry) }}</span>

          <span class="datum ml-auto">
            <time :datetime="entry.createdAt">{{
              new Date(entry.createdAt).toLocaleString()
            }}</time>
          </span>
        </div>

        <p class="mt-0.5 text-sm text-ink-500 dark:text-paper-400">
          <!--
            The author is a button rather than a link: it opens their dossier
            in this same station, which is where a decision about them is made.
          -->
          <button
            v-if="entry.authorId"
            type="button"
            class="underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:hover:text-paper-100"
            :aria-label="t('admin.activity.openAuthorAria', { name: entry.authorName ?? '' })"
            @click="focusAccount(entry.authorId)"
          >
            {{ entry.authorName ?? t('admin.activity.deletedAccount') }}
          </button>
          <span v-else>{{ t('admin.activity.deletedAccount') }}</span>

          <span v-if="entry.authorBanned" class="eyebrow ml-2 text-oxide-600 dark:text-oxide-300">
            {{ t('admin.accounts.blocked') }}
          </span>

          <template v-if="entry.editSummary"> — {{ entry.editSummary }}</template>
        </p>

        <!--
          The two judgements the diff supports, stated rather than left to be
          inferred from the change list. Both come from the same functions the
          moderation queue uses, so they cannot disagree with it.
        -->
        <p v-if="entry.blanking" class="mt-2 text-sm text-oxide-600 dark:text-oxide-300">
          {{ t('admin.activity.blankingWarning') }}
        </p>
        <p v-else-if="entry.substantial" class="mt-2 text-sm text-ink-500 dark:text-paper-400">
          {{ t('admin.activity.substantialNote') }}
        </p>

        <div class="mt-2">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="expanded.has(entry.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            :aria-expanded="expanded.has(entry.id)"
            :aria-label="t('admin.activity.toggleDiffAria', { id: entry.id })"
            @click="toggle(entry.id)"
          >
            {{ t('admin.activity.changeCount', { count: entry.changes.length }) }}
          </UButton>
        </div>

        <dl v-if="expanded.has(entry.id)" class="mt-2 space-y-2 text-sm">
          <div v-for="change in entry.changes" :key="change.field">
            <dt class="eyebrow text-ink-500 dark:text-paper-400">{{ change.field }}</dt>
            <dd class="mt-0.5 overflow-x-auto">
              <p v-if="change.before" class="text-ink-500 line-through dark:text-paper-400">
                {{ change.before }}
              </p>
              <p v-if="change.after" class="text-ink-900 dark:text-paper-100">
                {{ change.after }}
              </p>
            </dd>
          </div>
          <p v-if="entry.reviewNote" class="text-ink-500 dark:text-paper-400">
            {{ t('admin.activity.reviewNote', { note: entry.reviewNote }) }}
          </p>
        </dl>
      </li>
    </ul>

    <p v-if="fetchStatus !== 'pending' && items.length === 0" class="datum">
      {{ t('admin.activity.empty') }}
    </p>

    <UButton
      v-if="hasMore"
      size="sm"
      variant="subtle"
      color="neutral"
      :loading="isLoadingMore"
      @click="loadMore"
    >
      {{ t('admin.activity.loadMore') }}
    </UButton>
  </div>
</template>
