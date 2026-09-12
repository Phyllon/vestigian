<script setup lang="ts">
  import {
    checkBan,
    checkRoleChange,
    evaluateTrust,
    TRUST_THRESHOLD,
  } from '#shared/utils/authorization'
  import type {
    AdminAccountRow,
    AdminAccountsResponse,
    TrustEvaluation,
    UserRole,
  } from '#shared/types'

  /**
   * The account roll, and the sanctions.
   *
   * The list is a projection of `/api/admin/accounts`, which returns the
   * *inputs* to the trust rule rather than a level, so `evaluateTrust` runs
   * here and cannot disagree with the endpoints that queue an edit. Likewise
   * every control mirrors the rule that would refuse it — `checkRoleChange`,
   * `checkBan` — rather than restating a subset: a button that is present and
   * then refused teaches an administrator to distrust the interface.
   */
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()
  const { currentUser } = useSession()
  const stepUp = useAdminStepUp()

  const search = ref('')
  const debouncedSearch = ref('')
  /**
   * `'any'` rather than `''` for "no filter" — Reka UI's `SelectItem` refuses
   * an empty-string `value`, which it reserves internally to mean "cleared,
   * show the placeholder", and throws during setup if an ordinary option uses
   * it instead.
   */
  const role = ref<'any' | UserRole>('any')
  const standing = ref<'any' | 'trusted' | 'revoked' | 'banned' | 'unverified'>('any')
  const sort = ref<'accepted' | 'newest' | 'lastSeen' | 'pending'>('accepted')
  const busyUserId = ref<number | null>(null)

  let debounce: ReturnType<typeof setTimeout> | undefined

  watch(search, (value) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      debouncedSearch.value = value.trim()
    }, 300)
  })

  const focusedAccountId = computed<number | null>(() => {
    const raw = Number(route.query.account)
    return Number.isInteger(raw) && raw > 0 ? raw : null
  })

  // Not awaited — see the note in AdminImageQueue.vue on why `server: false`
  // and a top-level `await` together produce a hydration mismatch here.
  const {
    data,
    refresh,
    status: fetchStatus,
  } = useFetch<AdminAccountsResponse>('/api/admin/accounts', {
    server: false,
    query: computed(() => ({
      search: debouncedSearch.value || undefined,
      role: role.value === 'any' ? undefined : role.value,
      standing: standing.value === 'any' ? undefined : standing.value,
      sort: sort.value,
      limit: 50,
    })),
  })

  const accounts = computed(() => data.value?.accounts ?? [])

  const roleItems = computed(() => [
    { label: t('admin.accounts.roles.contributor'), value: 'contributor' },
    { label: t('admin.accounts.roles.moderator'), value: 'moderator' },
    { label: t('admin.accounts.roles.admin'), value: 'admin' },
  ])

  /** One phrase per reason `evaluateTrust` can give, in the server's own order. */
  const STANDING_BY_REASON: Record<TrustEvaluation['reason'], (row: AdminAccountRow) => string> = {
    moderator: () => t('admin.accounts.standing.moderator'),
    revoked: () => t('admin.accounts.standing.revoked'),
    earned: () => t('admin.accounts.standing.earned'),
    probation: (row) =>
      t('admin.accounts.standing.probation', {
        remaining: Math.max(TRUST_THRESHOLD - row.approvedContributions, 0),
      }),
  }

  const describeStanding = (row: AdminAccountRow): string =>
    row.bannedAt !== null
      ? t('admin.accounts.standing.blocked')
      : STANDING_BY_REASON[evaluateTrust(row).reason](row)

  const mayChangeRole = (row: AdminAccountRow): boolean =>
    currentUser.value !== null &&
    checkRoleChange({
      actor: currentUser.value,
      targetUserId: row.id,
      targetCurrentRole: row.role,
      // The demotion is the case that can be refused; asking about it is what
      // reveals whether this row is protected.
      nextRole: 'contributor',
    }).allowed

  const mayBlock = (row: AdminAccountRow): boolean =>
    currentUser.value !== null &&
    checkBan({
      actor: currentUser.value,
      targetUserId: row.id,
      targetCurrentRole: row.role,
    }).allowed

  /**
   * Blocking asks for a reason before it happens; lifting a block does not.
   *
   * Two steps rather than one for the same reason the contributor table's
   * suspension was two steps: the endpoint mails the person, and the reason is
   * the only part of a block they can act on, so a control that fired on the
   * first click would send that message with nothing in it.
   */
  const blockingUserId = ref<number | null>(null)
  const blockReason = ref('')

  const startBlocking = (row: AdminAccountRow): void => {
    blockingUserId.value = row.id
    blockReason.value = ''
  }

  const reportFailure = (error: unknown, title: string): void => {
    toast.add({
      title,
      description:
        (error as { data?: { message?: string } }).data?.message ?? t('admin.accounts.tryAgain'),
      color: 'error',
    })
  }

  interface BlockChange {
    row: AdminAccountRow
    blocked: boolean
    reason?: string
  }

  const setBlocked = async (change: BlockChange): Promise<void> => {
    busyUserId.value = change.row.id

    try {
      await stepUp.runPrivileged(async () => {
        await $fetch('/api/admin/ban', {
          method: 'POST',
          body: {
            userId: change.row.id,
            blocked: change.blocked,
            reason: change.reason?.trim() || undefined,
          },
        })
        toast.add({
          title: change.blocked
            ? t('admin.accounts.blockedToast', { name: change.row.displayName })
            : t('admin.accounts.unblockedToast', { name: change.row.displayName }),
          description: t('admin.accounts.toldByEmail', { name: change.row.displayName }),
          color: change.blocked ? 'neutral' : 'success',
        })
        blockingUserId.value = null
        await refresh()
        await refreshNuxtData(ADMIN_SYSTEM_KEY)
      })
    } catch (error) {
      reportFailure(error, t('admin.accounts.blockFailedTitle'))
    } finally {
      busyUserId.value = null
    }
  }

  const setRole = async (row: AdminAccountRow, nextRole: string): Promise<void> => {
    busyUserId.value = row.id

    try {
      await stepUp.runPrivileged(async () => {
        await $fetch('/api/moderation/role', {
          method: 'POST',
          body: { userId: row.id, role: nextRole },
        })
        toast.add({
          title: t('admin.accounts.nowRole', { name: row.displayName, role: nextRole }),
          color: 'success',
        })
        await refresh()
      })
    } catch (error) {
      reportFailure(error, t('admin.accounts.roleFailedTitle'))
    } finally {
      busyUserId.value = null
    }
  }

  const setTrust = async (row: AdminAccountRow, revoked: boolean): Promise<void> => {
    busyUserId.value = row.id

    try {
      await $fetch('/api/moderation/trust', {
        method: 'POST',
        body: { userId: row.id, revoked },
      })
      await refresh()
      await refreshNuxtData(ADMIN_SYSTEM_KEY)
    } catch (error) {
      reportFailure(error, t('admin.accounts.trustFailedTitle'))
    } finally {
      busyUserId.value = null
    }
  }

  const revokeSessions = async (row: AdminAccountRow): Promise<void> => {
    busyUserId.value = row.id

    try {
      await $fetch('/api/admin/sessions', { method: 'POST', body: { userId: row.id } })
      toast.add({
        title: t('admin.accounts.sessionsRevokedToast', { name: row.displayName }),
        color: 'neutral',
      })
    } catch (error) {
      reportFailure(error, t('admin.accounts.sessionsFailedTitle'))
    } finally {
      busyUserId.value = null
    }
  }

  const openDossier = (userId: number): void => {
    void router.replace({ query: { section: 'accounts', account: userId } })
  }

  const closeDossier = (): void => {
    void router.replace({ query: { section: 'accounts' } })
  }

  onBeforeUnmount(() => {
    clearTimeout(debounce)
  })
</script>

<template>
  <div class="space-y-4">
    <!--
      The dossier replaces the roll rather than sitting beside it. At 375px
      there is no beside, and on a wide screen a list you cannot act on while
      reading a dossier is a list in the way.
    -->
    <AdminAccountDossier
      v-if="focusedAccountId !== null"
      :user-id="focusedAccountId"
      @close="closeDossier"
      @changed="refresh"
    />

    <template v-else>
      <div class="leaf px-3 py-3 sm:px-4">
        <div class="flex flex-wrap items-end gap-2">
          <UFormField :label="t('admin.accounts.filters.search')" class="min-w-0 flex-1">
            <UInput
              v-model="search"
              icon="i-lucide-search"
              size="sm"
              class="w-full"
              :placeholder="t('admin.accounts.filters.searchPlaceholder')"
            />
          </UFormField>

          <UFormField :label="t('admin.accounts.filters.role')">
            <USelect
              v-model="role"
              size="sm"
              class="w-36"
              :items="[{ label: t('admin.accounts.filters.anyRole'), value: 'any' }, ...roleItems]"
            />
          </UFormField>

          <UFormField :label="t('admin.accounts.filters.standing')">
            <USelect
              v-model="standing"
              size="sm"
              class="w-40"
              :items="[
                { label: t('admin.accounts.filters.anyStanding'), value: 'any' },
                { label: t('admin.accounts.filters.trusted'), value: 'trusted' },
                { label: t('admin.accounts.filters.revoked'), value: 'revoked' },
                { label: t('admin.accounts.filters.banned'), value: 'banned' },
                { label: t('admin.accounts.filters.unverified'), value: 'unverified' },
              ]"
            />
          </UFormField>

          <UFormField :label="t('admin.accounts.filters.sort')">
            <USelect
              v-model="sort"
              size="sm"
              class="w-40"
              :items="[
                { label: t('admin.accounts.filters.sortAccepted'), value: 'accepted' },
                { label: t('admin.accounts.filters.sortNewest'), value: 'newest' },
                { label: t('admin.accounts.filters.sortLastSeen'), value: 'lastSeen' },
                { label: t('admin.accounts.filters.sortPending'), value: 'pending' },
              ]"
            />
          </UFormField>
        </div>
      </div>

      <p v-if="fetchStatus === 'pending'" class="datum">{{ t('admin.accounts.loading') }}</p>

      <!--
        A list of people, not a table: the count and the position in it are
        announced, which is what makes a long roll navigable by keyboard, and
        a real table at phone width is a horizontal scroll.
      -->
      <ul v-else class="space-y-3">
        <li v-for="row in accounts" :key="row.id" class="leaf px-3 py-3 sm:px-4">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 class="text-base text-ink-900 dark:text-paper-100">
              <button
                type="button"
                class="underline decoration-dotted underline-offset-2"
                :aria-label="t('admin.accounts.openDossierAria', { name: row.displayName })"
                @click="openDossier(row.id)"
              >
                {{ row.displayName }}
              </button>
            </h3>

            <span
              v-if="row.role !== 'contributor'"
              class="eyebrow text-bronze-600 dark:text-bronze-300"
            >
              {{ t(`admin.accounts.roles.${row.role}`) }}
            </span>

            <span v-if="row.bannedAt" class="eyebrow text-oxide-600 dark:text-oxide-300">
              {{ t('admin.accounts.blocked') }}
            </span>

            <span class="datum ml-auto">
              {{ t('admin.accounts.accepted', { count: row.approvedContributions }) }}
              <template v-if="row.pendingCount > 0">
                · {{ t('admin.accounts.waiting', { count: row.pendingCount }) }}</template
              >
            </span>
          </div>

          <!--
            The address, and the two account facts an administrator is
            otherwise guessing at. Monospace because an address is an
            identifier, which is what `.datum` is for.
          -->
          <p class="datum mt-0.5 break-all">{{ row.email }}</p>

          <p class="mt-0.5 text-sm text-ink-500 dark:text-paper-400">
            {{ describeStanding(row) }}
            <template v-if="!row.emailVerifiedAt"> · {{ t('admin.accounts.unverified') }}</template>
            <template v-if="row.twoFactorEnabled"> · {{ t('admin.accounts.twoFactor') }}</template>
          </p>

          <p v-if="row.banReason" class="mt-1 text-sm text-oxide-600 dark:text-oxide-300">
            {{ t('admin.accounts.blockReasonShown', { reason: row.banReason }) }}
          </p>

          <div v-if="blockingUserId !== row.id" class="mt-3 flex flex-wrap items-center gap-2">
            <!-- Every control here repeats per row, so each names its person. -->
            <UButton
              v-if="row.role === 'contributor' && !row.bannedAt"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="busyUserId === row.id"
              :aria-label="
                row.trustRevoked
                  ? t('admin.accounts.restoreTrustAria', { name: row.displayName })
                  : t('admin.accounts.revokeTrustAria', { name: row.displayName })
              "
              @click="setTrust(row, !row.trustRevoked)"
            >
              {{
                row.trustRevoked
                  ? t('admin.accounts.restoreTrust')
                  : t('admin.accounts.revokeTrust')
              }}
            </UButton>

            <USelect
              v-if="mayChangeRole(row)"
              :model-value="row.role"
              :items="roleItems"
              :aria-label="t('admin.accounts.roleAria', { name: row.displayName })"
              size="xs"
              class="w-40"
              @update:model-value="(value: string) => setRole(row, value)"
            />

            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-log-out"
              :loading="busyUserId === row.id"
              :aria-label="t('admin.accounts.revokeSessionsAria', { name: row.displayName })"
              @click="revokeSessions(row)"
            >
              {{ t('admin.accounts.revokeSessions') }}
            </UButton>

            <UButton
              v-if="mayBlock(row) && row.bannedAt"
              size="xs"
              color="success"
              :loading="busyUserId === row.id"
              :aria-label="t('admin.accounts.unblockAria', { name: row.displayName })"
              @click="setBlocked({ row, blocked: false })"
            >
              {{ t('admin.accounts.unblock') }}
            </UButton>

            <UButton
              v-else-if="mayBlock(row)"
              size="xs"
              variant="ghost"
              color="error"
              :aria-label="t('admin.accounts.blockAria', { name: row.displayName })"
              @click="startBlocking(row)"
            >
              {{ t('admin.accounts.block') }}
            </UButton>
          </div>

          <div v-else class="mt-3">
            <UFormField
              :label="t('admin.accounts.blockPrompt', { name: row.displayName })"
              :hint="t('admin.accounts.blockHint')"
            >
              <UInput
                v-model="blockReason"
                class="w-full"
                :placeholder="t('admin.accounts.blockReasonPlaceholder')"
              />
            </UFormField>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <UButton
                size="xs"
                color="error"
                :loading="busyUserId === row.id"
                @click="setBlocked({ row, blocked: true, reason: blockReason })"
              >
                {{ t('admin.accounts.block') }}
              </UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="blockingUserId = null">
                {{ t('admin.accounts.cancel') }}
              </UButton>
              <p class="datum">{{ t('admin.accounts.workUntouchedNote') }}</p>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="fetchStatus !== 'pending' && accounts.length === 0" class="datum">
        {{ t('admin.accounts.noMatches') }}
      </p>
    </template>

    <AdminStepUpDialog
      v-model:open="stepUp.isDialogOpen.value"
      :confirming="stepUp.isConfirming.value"
      :error="stepUp.error.value"
      @confirm="stepUp.confirm"
      @cancel="stepUp.cancel"
    />
  </div>
</template>
