<script setup lang="ts">
  import { ADMIN_ACTIONS, adminActionMessageKey } from '#shared/utils/authorization'
  import type { AdminAuditEntryRow, AdminAuditResponse } from '#shared/types'

  /**
   * The panel's own accountability.
   *
   * An administrator here can read every registered address and lock people
   * out; "tough security" nobody can inspect afterwards is a claim rather than
   * a property. Deliberately read-only, and not because writing was hard:
   * `recordAdminAction` only ever inserts, so there is nothing in the
   * application that could offer an edit control here even if this component
   * wanted one.
   */
  const { t } = useI18n()
  const router = useRouter()

  /**
   * `'any'` rather than `''` for "no filter" — Reka UI's `SelectItem` refuses
   * an empty-string `value`, which it reserves internally to mean "cleared,
   * show the placeholder", and throws during setup if an ordinary option uses
   * it instead.
   */
  const action = ref<'any' | (typeof ADMIN_ACTIONS)[number]>('any')
  const pages = ref<AdminAuditEntryRow[][]>([])
  const cursor = ref<number | null>(null)
  const isLoadingMore = ref(false)

  const query = computed(() => ({
    action: action.value === 'any' ? undefined : action.value,
    limit: 50,
  }))

  // Not awaited — see the note in AdminImageQueue.vue on why `server: false`
  // and a top-level `await` together produce a hydration mismatch here.
  const { data, status: fetchStatus } = useFetch<AdminAuditResponse>('/api/admin/audit', {
    server: false,
    query,
  })

  watch(query, () => {
    pages.value = []
    cursor.value = null
  })

  const entries = computed(() => [...(data.value?.entries ?? []), ...pages.value.flat()])

  const hasMore = computed(() =>
    pages.value.length > 0 ? cursor.value !== null : (data.value?.nextCursor ?? null) !== null,
  )

  const loadMore = async (): Promise<void> => {
    const next = cursor.value ?? data.value?.nextCursor ?? null
    if (next === null) return

    isLoadingMore.value = true
    try {
      const page = await $fetch<AdminAuditResponse>('/api/admin/audit', {
        query: { ...query.value, cursor: next },
      })
      pages.value = [...pages.value, page.entries]
      cursor.value = page.nextCursor
    } finally {
      isLoadingMore.value = false
    }
  }

  const actionItems = computed(() => [
    { label: t('admin.audit.anyAction'), value: 'any' },
    ...ADMIN_ACTIONS.map((value) => ({ label: t(adminActionMessageKey(value)), value })),
  ])

  const focusAccount = (userId: number): void => {
    void router.replace({ query: { section: 'accounts', account: userId } })
  }

  /**
   * The detail blob is rendered as plain `key: value` pairs rather than as
   * JSON. It is written by the endpoints, not by a person, so there is nothing
   * to escape beyond what `{{ }}` already does — but there is also nothing to
   * gain from showing an administrator a brace.
   */
  const describeDetail = (detail: Record<string, unknown> | null): string =>
    detail
      ? Object.entries(detail)
          .filter(([, value]) => value !== null && value !== '')
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(' · ')
      : ''
</script>

<template>
  <div class="space-y-4">
    <div class="leaf px-3 py-3 sm:px-4">
      <UFormField :label="t('admin.audit.filterLabel')">
        <USelect v-model="action" size="sm" class="w-64" :items="actionItems" />
      </UFormField>
      <p class="mt-2 max-w-prose text-sm text-ink-500 dark:text-paper-400">
        {{ t('admin.audit.note') }}
      </p>
    </div>

    <p v-if="fetchStatus === 'pending'" class="datum">{{ t('admin.audit.loading') }}</p>

    <ol v-else class="space-y-2">
      <li v-for="entry in entries" :key="entry.id" class="leaf px-3 py-2 sm:px-4">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-sm text-ink-900 dark:text-paper-100">
            {{ t(adminActionMessageKey(entry.action)) }}
          </span>

          <button
            v-if="entry.subjectType === 'account' && entry.subjectId"
            type="button"
            class="datum underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:hover:text-paper-100"
            @click="focusAccount(entry.subjectId)"
          >
            {{ t('admin.audit.account', { id: entry.subjectId }) }}
          </button>

          <span class="datum ml-auto">
            {{ entry.actorName ?? t('admin.audit.deletedActor') }} ·
            <time :datetime="entry.createdAt">{{
              new Date(entry.createdAt).toLocaleString()
            }}</time>
          </span>
        </div>

        <p v-if="describeDetail(entry.detail)" class="datum mt-0.5 break-words">
          {{ describeDetail(entry.detail) }}
        </p>
      </li>
    </ol>

    <p v-if="fetchStatus !== 'pending' && entries.length === 0" class="datum">
      {{ t('admin.audit.empty') }}
    </p>

    <UButton
      v-if="hasMore"
      size="sm"
      variant="subtle"
      color="neutral"
      :loading="isLoadingMore"
      @click="loadMore"
    >
      {{ t('admin.audit.loadMore') }}
    </UButton>
  </div>
</template>
