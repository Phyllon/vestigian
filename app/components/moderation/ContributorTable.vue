<script setup lang="ts">
  import { checkRoleChange, evaluateTrust, TRUST_THRESHOLD } from '#shared/utils/authorization'
  import type { TrustEvaluation, UserRole } from '#shared/types'

  interface ContributorRow {
    id: number
    displayName: string
    role: UserRole
    approvedContributions: number
    trustRevoked: boolean
    pendingCount: number
    createdAt: string
    lastSeenAt: string | null
  }

  interface ContributorList {
    adminCount: number
    contributors: ContributorRow[]
  }

  const { t } = useI18n()
  const { currentUser } = useSession()
  const toast = useToast()

  const search = ref('')
  const busyUserId = ref<number | null>(null)

  /**
   * Suspension asks for a reason before it happens; restoring does not.
   *
   * Two steps rather than one because the endpoint now emails the contributor:
   * the reason is the only part of a suspension they can act on, and a control
   * that fires on the first click would send that mail with nothing in it.
   */
  const suspendingUserId = ref<number | null>(null)
  const suspensionReason = ref('')

  const { data, refresh } = await useFetch<ContributorList>('/api/moderation/users', {
    query: { search },
  })

  const contributors = computed(() => data.value?.contributors ?? [])

  const roleOptions = computed(() => [
    { label: t('moderation.contributorTable.roles.contributor'), value: 'contributor' },
    { label: t('moderation.contributorTable.roles.moderator'), value: 'moderator' },
    { label: t('moderation.contributorTable.roles.admin'), value: 'admin' },
  ])

  /**
   * One phrase per reason `evaluateTrust` can give, so the branch order is the
   * server's rather than something a reader has to check against it by eye.
   */
  const STANDING_BY_REASON: Record<TrustEvaluation['reason'], (row: ContributorRow) => string> = {
    moderator: () => t('moderation.contributorTable.standing.moderator'),
    revoked: () => t('moderation.contributorTable.standing.revoked'),
    earned: () => t('moderation.contributorTable.standing.earned'),
    probation: (row) =>
      t('moderation.contributorTable.standing.probation', {
        remaining: Math.max(TRUST_THRESHOLD - row.approvedContributions, 0),
      }),
  }

  const describeStanding = (row: ContributorRow): string =>
    STANDING_BY_REASON[evaluateTrust(row).reason](row)

  /**
   * Mirrors `checkRoleChange` rather than restating a subset of it, so the
   * select is absent in exactly the cases the endpoint would refuse — including
   * the last admin, which this component used to offer and then 403 on.
   */
  const mayChangeRole = (row: ContributorRow): boolean =>
    currentUser.value !== null &&
    checkRoleChange({
      actor: currentUser.value,
      targetUserId: row.id,
      targetCurrentRole: row.role,
      // The demotion is the case that can be refused; asking about it is what
      // reveals whether this row is the last admin.
      nextRole: 'contributor',
      adminCount: data.value?.adminCount ?? 0,
    }).allowed

  const startSuspension = (row: ContributorRow): void => {
    suspendingUserId.value = row.id
    suspensionReason.value = ''
  }

  const cancelSuspension = (): void => {
    suspendingUserId.value = null
  }

  interface TrustChange {
    row: ContributorRow
    revoked: boolean
    reason?: string
  }

  const setTrust = async (change: TrustChange): Promise<void> => {
    busyUserId.value = change.row.id
    try {
      await $fetch('/api/moderation/trust', {
        method: 'POST',
        body: {
          userId: change.row.id,
          revoked: change.revoked,
          reason: change.reason?.trim() || undefined,
        },
      })
      toast.add({
        title: change.revoked
          ? t('moderation.contributorTable.trustSuspended')
          : t('moderation.contributorTable.trustRestored'),
        description: t('moderation.contributorTable.toldByEmail', { name: change.row.displayName }),
        color: change.revoked ? 'neutral' : 'success',
      })
      suspendingUserId.value = null
      await refresh()
    } catch (error) {
      toast.add({
        title: t('moderation.contributorTable.trustFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('moderation.contributorTable.tryAgain'),
        color: 'error',
      })
    } finally {
      busyUserId.value = null
    }
  }

  const setRole = async (row: ContributorRow, role: string): Promise<void> => {
    busyUserId.value = row.id
    try {
      await $fetch('/api/moderation/role', { method: 'POST', body: { userId: row.id, role } })
      toast.add({
        title: t('moderation.contributorTable.nowRole', { name: row.displayName, role }),
        color: 'success',
      })
      await refresh()
    } catch (error) {
      toast.add({
        title: t('moderation.contributorTable.roleFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('moderation.contributorTable.tryAgain'),
        color: 'error',
      })
    } finally {
      busyUserId.value = null
    }
  }
</script>

<template>
  <div class="space-y-4">
    <UInput
      v-model="search"
      :placeholder="t('moderation.contributorTable.findPlaceholder')"
      :aria-label="t('moderation.contributorTable.findPlaceholder')"
      icon="i-lucide-search"
      class="w-full max-w-xs"
    />

    <!--
      A list of people, not a stack of panels: the count and the position in it
      are announced, which is what makes a long roll navigable by keyboard.
    -->
    <ul class="space-y-4">
      <li v-for="row in contributors" :key="row.id" class="leaf px-4 py-3">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="text-base text-ink-900 dark:text-paper-100">{{ row.displayName }}</h2>
          <span
            v-if="row.role !== 'contributor'"
            class="eyebrow text-oxide-600 dark:text-oxide-300"
          >
            {{ t(`moderation.contributorTable.roles.${row.role}`) }}
          </span>
          <span class="datum ml-auto">
            {{ t('moderation.contributorTable.accepted', { count: row.approvedContributions }) }}
            <template v-if="row.pendingCount > 0">
              ·
              {{ t('moderation.contributorTable.waiting', { count: row.pendingCount }) }}</template
            >
          </span>
        </div>

        <p class="mt-0.5 text-sm text-ink-500 dark:text-paper-400">
          {{ describeStanding(row) }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- Every control here repeats per row, so each names its person. -->
          <UButton
            v-if="row.role === 'contributor' && row.trustRevoked"
            size="xs"
            color="success"
            :loading="busyUserId === row.id"
            :aria-label="
              t('moderation.contributorTable.restoreTrustAria', { name: row.displayName })
            "
            @click="setTrust({ row, revoked: false })"
          >
            {{ t('moderation.contributorTable.restoreTrust') }}
          </UButton>

          <UButton
            v-else-if="row.role === 'contributor' && suspendingUserId !== row.id"
            size="xs"
            variant="ghost"
            color="error"
            :aria-label="
              t('moderation.contributorTable.suspendPublishingAria', { name: row.displayName })
            "
            @click="startSuspension(row)"
          >
            {{ t('moderation.contributorTable.suspendPublishing') }}
          </UButton>

          <USelect
            v-if="mayChangeRole(row) && suspendingUserId !== row.id"
            :model-value="row.role"
            :items="roleOptions"
            :aria-label="t('moderation.contributorTable.roleAria', { name: row.displayName })"
            size="xs"
            class="w-40"
            @update:model-value="(value: string) => setRole(row, value)"
          />
        </div>

        <div v-if="suspendingUserId === row.id" class="mt-3">
          <UFormField
            :label="t('moderation.contributorTable.suspendPrompt', { name: row.displayName })"
            :hint="t('moderation.contributorTable.suspendHint')"
          >
            <UInput
              v-model="suspensionReason"
              :placeholder="t('moderation.contributorTable.suspendReasonPlaceholder')"
              class="w-full"
            />
          </UFormField>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <UButton
              size="xs"
              color="error"
              :loading="busyUserId === row.id"
              @click="setTrust({ row, revoked: true, reason: suspensionReason })"
            >
              {{ t('moderation.contributorTable.suspendPublishing') }}
            </UButton>
            <UButton size="xs" variant="ghost" color="neutral" @click="cancelSuspension">
              {{ t('moderation.contributorTable.cancel') }}
            </UButton>
            <p class="datum">{{ t('moderation.contributorTable.untouchedNote') }}</p>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="contributors.length === 0" class="datum">
      {{ t('moderation.contributorTable.noMatches') }}
    </p>
  </div>
</template>
