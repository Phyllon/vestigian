<script setup lang="ts">
  import { ADMIN_SECTIONS } from '#shared/types'
  import type { AdminAccountsResponse, AdminAttentionCounts, AdminSection } from '#shared/types'

  /**
   * The bar the whole panel is steered from: one search field, the section
   * switcher, and what currently wants attention.
   *
   * The search is deliberately **not** a filter on the section below it. It
   * jumps: type a display name or an address and you get accounts to open, type
   * `#412` and you go to that revision. Per-section filtering already exists
   * inside each section, server-side, where it can see the whole table rather
   * than the page in front of it — a second search meaning something different
   * in the same screen would be worse than either.
   */
  const props = defineProps<{
    section: AdminSection
    attention: AdminAttentionCounts | null
    status: 'ready' | 'degraded' | null
  }>()

  const emit = defineEmits<{
    'update:section': [AdminSection]
    'focus-account': [number | null]
  }>()

  const { t } = useI18n()
  const router = useRouter()

  const term = ref('')
  const isSearchOpen = ref(false)

  const sectionItems = computed(() =>
    ADMIN_SECTIONS.map((value) => ({ label: t(`admin.sections.${value}`), value })),
  )

  /** `#412` or a bare number is a revision id; anything else is a person. */
  const revisionId = computed<number | null>(() => {
    const match = /^#?(\d{1,9})$/.exec(term.value.trim())
    return match ? Number(match[1]) : null
  })

  /**
   * Debounced by hand rather than by a watcher on every keystroke: this is an
   * audited, email-returning endpoint and it should not be called once per
   * character typed into a search box.
   */
  const debouncedTerm = ref('')
  let debounce: ReturnType<typeof setTimeout> | undefined

  watch(term, (value) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      debouncedTerm.value = value.trim()
    }, 300)
  })

  // Not awaited — a top-level `await` here makes this an async-setup
  // component regardless of `immediate: false`, and Vue then implicitly
  // wraps it in `<Suspense>`; see the note in AdminImageQueue.vue for what
  // that did to hydration once any admin component actually fetches.
  const { data: matches } = useFetch<AdminAccountsResponse>('/api/admin/accounts', {
    server: false,
    query: computed(() => ({ search: debouncedTerm.value || undefined, limit: 6 })),
    // Nothing to look up until there is something to look up, and a blank
    // search would otherwise return the first six accounts as "results".
    immediate: false,
    watch: [debouncedTerm],
  })

  const accountMatches = computed(() =>
    debouncedTerm.value.length >= 2 && revisionId.value === null
      ? (matches.value?.accounts ?? [])
      : [],
  )

  const jumpToRevision = (): void => {
    if (revisionId.value === null) return
    void router.replace({ query: { section: 'activity', revision: revisionId.value } })
    term.value = ''
    isSearchOpen.value = false
  }

  const openAccount = (userId: number): void => {
    emit('focus-account', userId)
    term.value = ''
    isSearchOpen.value = false
  }

  /**
   * What is actually waiting, worst first, and only the ones that are not
   * zero — a strip of noughts trains you to stop reading it.
   *
   * `urgent` marks the single line that gets the oxide red, per the design
   * brief's once-per-screen rule: an unresolved licence is the only entry here
   * that is a rule being broken rather than a queue being long, since such an
   * image must never publish at all.
   */
  const attentionItems = computed(() => {
    const counts = props.attention
    if (!counts) return []

    return [
      {
        key: 'unresolvedLicences',
        value: counts.unresolvedLicences,
        urgent: true,
        section: 'images' as AdminSection,
      },
      {
        key: 'pendingRevisions',
        value: counts.pendingRevisions,
        urgent: false,
        section: 'activity' as AdminSection,
      },
      {
        key: 'pendingImages',
        value: counts.pendingImages,
        urgent: false,
        section: 'images' as AdminSection,
      },
      {
        key: 'blockedAccounts',
        value: counts.blockedAccounts,
        urgent: false,
        section: 'accounts' as AdminSection,
      },
      {
        key: 'revokedTrust',
        value: counts.revokedTrust,
        urgent: false,
        section: 'accounts' as AdminSection,
      },
      {
        key: 'unverifiedAccounts',
        value: counts.unverifiedAccounts,
        urgent: false,
        section: 'accounts' as AdminSection,
      },
    ].filter((item) => item.value > 0)
  })

  onBeforeUnmount(() => {
    clearTimeout(debounce)
  })
</script>

<template>
  <div class="leaf sticky top-16 z-10 px-3 py-3 sm:px-4">
    <div class="flex flex-wrap items-center gap-2">
      <!--
        Collapsed to an icon below `sm`: at 375px a full-width search field
        plus a section select leaves no room for either, and the section
        switcher is the control someone reaches for first.
      -->
      <UButton
        class="sm:hidden"
        icon="i-lucide-search"
        variant="ghost"
        color="neutral"
        size="sm"
        :aria-label="t('admin.commandBar.searchLabel')"
        :aria-expanded="isSearchOpen"
        @click="isSearchOpen = !isSearchOpen"
      />

      <div class="relative hidden min-w-0 flex-1 sm:block">
        <UInput
          v-model="term"
          icon="i-lucide-search"
          size="sm"
          class="w-full"
          :placeholder="t('admin.commandBar.placeholder')"
          :aria-label="t('admin.commandBar.searchLabel')"
          @keydown.enter="jumpToRevision"
        />
      </div>

      <USelect
        :model-value="props.section"
        :items="sectionItems"
        size="sm"
        class="w-40"
        :aria-label="t('admin.commandBar.sectionLabel')"
        @update:model-value="(value: string) => emit('update:section', value as AdminSection)"
      />

      <!--
        The one place the panel reports on itself. `aria-live` so a degraded
        backing service is announced rather than only coloured.
      -->
      <p
        v-if="props.status"
        class="datum ml-auto flex items-center gap-1"
        aria-live="polite"
        :class="props.status === 'degraded' ? 'text-oxide-600 dark:text-oxide-300' : undefined"
      >
        <UIcon
          :name="props.status === 'degraded' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
          class="size-3"
          aria-hidden="true"
        />
        {{ t(`admin.commandBar.status.${props.status}`) }}
      </p>
    </div>

    <div v-if="isSearchOpen" class="mt-2 sm:hidden">
      <UInput
        v-model="term"
        icon="i-lucide-search"
        size="sm"
        class="w-full"
        :placeholder="t('admin.commandBar.placeholder')"
        :aria-label="t('admin.commandBar.searchLabel')"
        @keydown.enter="jumpToRevision"
      />
    </div>

    <!-- Jump targets. A list, so the count and position are announced. -->
    <div v-if="revisionId !== null || accountMatches.length > 0" class="mt-3">
      <p class="eyebrow text-ink-500 dark:text-paper-400">
        {{ t('admin.commandBar.jumpTo') }}
      </p>

      <ul class="mt-1 space-y-1">
        <li v-if="revisionId !== null">
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-file-diff"
            @click="jumpToRevision"
          >
            {{ t('admin.commandBar.revision', { id: revisionId }) }}
          </UButton>
        </li>
        <li v-for="match in accountMatches" :key="match.id">
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-user"
            :aria-label="t('admin.commandBar.openAccountAria', { name: match.displayName })"
            @click="openAccount(match.id)"
          >
            {{ match.displayName }}
            <span class="datum">{{ match.email }}</span>
            <span v-if="match.bannedAt" class="eyebrow text-oxide-600 dark:text-oxide-300">
              {{ t('admin.accounts.blocked') }}
            </span>
          </UButton>
        </li>
      </ul>
    </div>

    <!--
      The attention strip. Polite rather than assertive: these numbers change
      as a side effect of work happening elsewhere in the panel, and an
      assertive region would interrupt whatever the administrator is reading
      every time a queue shortened.
    -->
    <ul
      v-if="attentionItems.length > 0"
      class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-paper-200 pt-2 dark:border-night-700"
      aria-live="polite"
      :aria-label="t('admin.commandBar.attentionLabel')"
    >
      <li v-for="item in attentionItems" :key="item.key">
        <button
          type="button"
          class="datum underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:hover:text-paper-100"
          :class="item.urgent ? 'text-oxide-600 dark:text-oxide-300' : undefined"
          @click="emit('update:section', item.section)"
        >
          {{ t(`admin.attention.${item.key}`, { count: item.value }) }}
        </button>
      </li>
    </ul>
  </div>
</template>
